import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { router } from '@kit.ArkUI';

/**
 * 外部网页承载页（**ArkWeb**）。
 *
 * 合规背景（应用市场「内部规则」）：应用渲染/打开网页必须使用 ArkWeb 组件。本应用的主界面
 * 是应用自带的本地界面（进程内 Host 同源提供），凡需打开**外部网页**（帮助 / 文档 / 隐私政策 /
 * 用户协议 / 外链）一律经本页渲染，不再经由内嵌 Chromium。
 *
 * 入参：`router.pushUrl({ url: 'pages/ExternalWeb', params: { url, title? } })`。
 * 页面需在 `resources/base/profile/main_pages.json` 中登记（与 WebPage 页一致）。
 */
@Entry
@Component
export struct ExternalWeb {
  @State private webUrl: string = '';
  @State private pageTitle: string = '';
  @State private progress: number = 0;
  private logTag: string = 'ExternalWeb';
  private domainId: number = 0x0000;
  private controller: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string> | undefined;
    this.webUrl = params?.url ?? '';
    this.pageTitle = params?.title ?? '';
    hilog.info(this.domainId, this.logTag, 'aboutToAppear, url=%{public}s', this.webUrl);
  }

  aboutToDisappear(): void {
    try {
      if (this.webUrl) {
        this.controller.stop();
      }
    } catch (error) {
      hilog.error(this.domainId, this.logTag, 'stop failed: %{public}s', JSON.stringify(error));
    }
  }

  build() {
    Column() {
      // 顶部栏：返回 + 标题
      Row() {
        Button({ type: ButtonType.Normal }) {
          Image($r('sys.media.ohos_ic_compnent_titlebar_back'))
            .backgroundColor(Color.Transparent)
            .borderRadius(20)
            .width(24)
            .height(24)
            .draggable(false)
            .autoResize(false)
            .focusable(true)
            .fillColor($r('sys.color.ohos_id_color_titlebar_icon'))
            .matchTextDirection(true)
        }
        .backgroundColor($r('sys.color.ohos_id_color_button_normal'))
        .borderRadius(20)
        .width(40)
        .height(40)
        .onClick(() => {
          router.back();
        })

        Text(this.pageTitle)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ left: 12 })
          .layoutWeight(1)
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })
      .alignItems(VerticalAlign.Center)

      Progress({ value: this.progress, type: ProgressType.Linear })
        .width('100%')
        .visibility(this.progress <= 99 ? Visibility.Visible : Visibility.None)

      // 外部网页统一由 ArkWeb 渲染；空 URL 直接给出提示，杜绝空白页。
      if (this.webUrl.length === 0) {
        Column() {
          Text('无效的网页地址')
            .fontSize(14)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Web({ src: this.webUrl, controller: this.controller })
          .backgroundColor(Color.Transparent)
          .width('100%')
          .layoutWeight(1)
          .darkMode(WebDarkMode.Auto)
          .forceDarkAccess(true)
          .onProgressChange((event) => {
            this.progress = event ? event.newProgress : 0;
          })
          .onErrorReceive((event) => {
            if (event) {
              hilog.error(this.domainId, this.logTag,
                'onErrorReceive: %{public}s', event?.error?.getErrorInfo() ?? '');
            }
          })
      }
    }
    .backgroundColor(0xffffff)
    .width('100%')
    .height('100%')
  }
}
