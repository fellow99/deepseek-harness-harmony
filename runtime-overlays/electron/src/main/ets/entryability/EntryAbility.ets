// Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * 应用入口 Ability。
 *
 * 本工程对上游副本的唯一定制是「后台保活」（能力清单 K1）：窗口最小化或锁屏后，
 * Electron 主进程（同时承载 dsh Host）不应被系统挂起，否则正在跑的会话与后台任务会被冻结。
 *
 * 机制：`module.json5` 为 `EntryAbility` 声明 `backgroundModes: ["taskKeeping"]` 并请求
 * `ohos.permission.KEEP_BACKGROUND_RUNNING`；本文件在 `onBackground` 申请长时任务、
 * 在 `onForeground` 释放。
 *
 * 注意三条系统约束，它们决定了这里为什么必须容错而不是断言：
 *   1. 仅 UIAbility 可申请长时任务（本类是 UIAbility，其基类 `WebAbility` 也是）；
 *   2. 申请成功通知栏必显，用户删除该通知即停止任务——应用无法阻止，也不应假装拥有它；
 *   3. 系统会校验业务一致性，申请可能被拒（返回非 0 或抛错），此时应用应退回原行为。
 * 因此每一次申请/释放都只记录日志、绝不向上抛，避免保活失败连带影响启动流程。
 *
 * 保活失败不影响任何既有能力：需要 dsh 侧配合的部分（后台任务执行后端）见能力清单 T1。
 */

import window from '@ohos.window';
import Want from '@ohos.app.ability.Want';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import { Configuration } from '@ohos.app.ability.Configuration';
import { BusinessError } from '@ohos.base';
import backgroundTaskManager from '@ohos.resourceschedule.backgroundTaskManager';
import wantAgent, { WantAgent } from '@ohos.app.ability.wantAgent';
import hilog from '@ohos.hilog';

import { WebAbility } from 'web_engine';

/** 与主进程共用的 hilog 标签，便于 `hilog | grep dsh-harmony` 统一排查。 */
const LOG_TAG: string = 'dsh-harmony';
const LOG_DOMAIN: number = 0x0000;

export default class EntryAbility extends WebAbility {
  /**
   * 是否已申请到长时任务。
   *
   * 只记「是否已申请」而不记任务 id：本项目使用的
   * `startBackgroundRunning(context, bgMode, wantAgent)` 重载返回 `Promise<void>`，
   * **不提供任务 id**（只有 `string[]` 与 `ContinuousTaskRequest` 两个重载才返回
   * `ContinuousTaskNotification`）；而 `stopBackgroundRunning(context)` 也不需要 id。
   * 该标志只用于让 `onBackground` 的重复触发保持幂等。
   */
  private keepAliveRequested: boolean = false;

  /**
   * 申请长时任务，使应用在最小化/锁屏后不被挂起。
   *
   * 幂等：已申请过时直接返回，避免 `onBackground` 被重复触发时反复申请。
   */
  private async acquireKeepAlive(): Promise<void> {
    if (this.keepAliveRequested) {
      return;
    }
    try {
      // 通知的点击目标指回本 Ability，这样用户从通知回到应用时复用既有实例
      // （`launchType: specified`），而不是新起一个窗口。
      const agentInfo: wantAgent.WantAgentInfo = {
        wants: [
          {
            bundleName: this.context.abilityInfo.bundleName,
            abilityName: this.context.abilityInfo.name,
          },
        ],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 0,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
      };
      const agent: WantAgent = await wantAgent.getWantAgent(agentInfo);
      await backgroundTaskManager.startBackgroundRunning(
        this.context,
        backgroundTaskManager.BackgroundMode.TASK_KEEPING,
        agent,
      );
      this.keepAliveRequested = true;
      hilog.info(LOG_DOMAIN, LOG_TAG, '后台保活已申请（长时任务 TASK_KEEPING）');
    } catch (error) {
      const failure = error as BusinessError;
      hilog.error(LOG_DOMAIN, LOG_TAG, '后台保活申请失败（应用退回原行为）: %{public}s', failure.message);
    }
  }

  /**
   * 释放长时任务并清除通知。
   *
   * 即使释放失败也先把本地标志清掉：任务已不在我们掌控中，留着旧标志只会阻止下一次申请。
   */
  private async releaseKeepAlive(): Promise<void> {
    if (!this.keepAliveRequested) {
      return;
    }
    this.keepAliveRequested = false;
    try {
      await backgroundTaskManager.stopBackgroundRunning(this.context);
      hilog.info(LOG_DOMAIN, LOG_TAG, '后台保活已释放');
    } catch (error) {
      const failure = error as BusinessError;
      hilog.error(LOG_DOMAIN, LOG_TAG, '后台保活释放失败: %{public}s', failure.message);
    }
  }

  onConfigurationUpdate(config: Configuration) {
    super.onConfigurationUpdate(config);
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam) {
    super.onCreate(want, launchParam);
  }

  onDestroy() {
    this.releaseKeepAlive();
    super.onDestroy();
  }

  onWindowStageCreate(windowStage: window.WindowStage) {
    super.onWindowStageCreate(windowStage);
  }

  onWindowStageDestroy() {
    super.onWindowStageDestroy();
  }

  onForeground() {
    super.onForeground();
    this.releaseKeepAlive();
  }

  onBackground() {
    super.onBackground();
    this.acquireKeepAlive();
  }
};
