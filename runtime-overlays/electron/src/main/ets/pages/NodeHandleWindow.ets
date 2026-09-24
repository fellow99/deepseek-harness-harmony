/*
 * Copyright (c) 2023-2025 Huawei Device Co., Ltd.
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of
 *    conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list
 *    of conditions and the following disclaimer in the documentation and/or other materials
 *    provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used
 *    to endorse or promote products derived from this software without specific prior written
 *    permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
 * ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { WebNodeHandleWindow } from 'web_engine';
import CustomChildProcess from '../process/CustomChildProcess';
import { KeyCode } from '@kit.InputKit';
import { uiObserver } from '@kit.ArkUI';
import LogUtil from 'web_engine/src/main/ets/utils/LogUtil';

const TAG: string = 'NodeHandleWindow';

/** AI 生成合成内容显式标识：应用右下角常驻灰字（合规要求，勿删）。 */
const AI_NOTICE_TEXT: string = '内容由 AI 生成，仅供参考';

interface IStyleData {
  backgroundColor: string,
  opacity: number
};

interface IUpdateStyle {
  registerUpdateStyleFunction: Function,
  removeUpdateStyleFunction: Function
};

CustomChildProcess.toString();
let storage = LocalStorage.getShared();
@Entry(storage)
@Component
struct NodeHandleWindow {
  @LocalStorageLink('updateStyle') updateStyle: IUpdateStyle = {
    registerUpdateStyleFunction: (id: string, initStyle: IStyleData,
      func: (style: IStyleData) => void) => {},
    removeUpdateStyleFunction: (id: string) => {}
  };
  @LocalStorageLink('xcomponentId') xcomponentId: string = '';
  private initStyle: IStyleData = {
    backgroundColor: 'ffffffff',
    opacity: 1
  };

  @State private backgroundColor_: string = `#${this.initStyle.backgroundColor}`;
  @State private opacity_: number = this.initStyle.opacity;

  @LocalStorageProp('statusBarHeight') statusBarHeight: number = 0;
  @State density: number = 0;

  aboutToAppear(): void {
    this.updateStyle.registerUpdateStyleFunction(this.xcomponentId, this.initStyle, (style: IStyleData) => {
      this.backgroundColor_ = `#${style.backgroundColor}`;
      this.opacity_ = style.opacity;
    });
    uiObserver.on('densityUpdate', this.getUIContext(), (info: uiObserver.DensityInfo) => {
      this.density = info.density;
    });
  }

  aboutToDisappear(): void {
    this.updateStyle.removeUpdateStyleFunction(this.xcomponentId);
    uiObserver.off('densityUpdate', this.getUIContext());
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Row() {
        WebNodeHandleWindow()
      }.onKeyEvent((event?: KeyEvent) => {
        if (event) {
          if (event.type == KeyType.Down && event.keyCode == KeyCode.KEYCODE_ESCAPE) {
            event.stopPropagation();
          }
        }
      })
      .backgroundColor(this.backgroundColor_)
      .opacity(this.opacity_)
      .width('100%')
      .height('100%')
      .padding({
        top: this.getStatusBarHeight(),
      })

      // AI 生成内容显式标识：常驻右下角灰字，HitTestMode.None 使其不拦截点击/键盘。
      Text(AI_NOTICE_TEXT)
        .fontSize(12)
        .fontColor('#8C8C8C')
        .opacity(0.6)
        .margin({ right: 12, bottom: 8 })
        .hitTestBehavior(HitTestMode.None)
    }
    .width('100%')
    .height('100%')
  }

  getStatusBarHeight(): number {
    LogUtil.info(TAG, 'Avoidance function, statusBarHeight:' + this.statusBarHeight + ',density:' + this.density);
    return this.getUIContext().px2vp(this.statusBarHeight);
  }
}
