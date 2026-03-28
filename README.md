# 字幕时间轴播放器

这是一个本地轻量播放器工程，读取视频和对应的字幕 Markdown 文件，并把 `## Segments` 渲染成可点击的时间轴字幕列表。

## 当前使用方式

推荐工作流：

1. 在一个目录里准备好同名文件
   例如：
   - `demo.mp4`
   - `demo.md`
2. 启动播放器工程
3. 在页面中选择这个本地目录
4. 在左侧视频下方的视频列表中点选项目
5. 页面自动加载对应视频和字幕

## 当前功能

- 选择本地文件夹后，自动扫描同名 `.mp4 + .md` 配对
- 左侧视频下方显示可点击的视频列表
- 点击视频列表项后自动加载对应视频和字幕
- 右侧显示时间轴字幕列表
- 点击右侧字幕可跳转视频
- 自动生成 VTT
- 视频内字幕默认关闭，可通过开关打开
- 支持下载当前生成的 VTT

## 启动

```powershell
powershell -ExecutionPolicy Bypass -File E:\myvideo\subtitle-player\start.ps1
```

如果 `8765` 端口被占用，可以换端口：

```powershell
powershell -ExecutionPolicy Bypass -File E:\myvideo\subtitle-player\start.ps1 -Port 8766
```

## 手动转换 Markdown 为 VTT

```powershell
node E:\myvideo\subtitle-player\convert-md-to-vtt.mjs "E:\path\demo.md"
```

## 手动切换默认项目并启动

```powershell
powershell -ExecutionPolicy Bypass -File E:\myvideo\subtitle-player\start.ps1 `
  -Title "demo" `
  -VideoPath "E:\path\demo.mp4" `
  -MarkdownPath "E:\path\demo.md"
```

## 注意

- 不要再使用 `python -m http.server`
- 请使用工程内置的 [serve.py](/E:/myvideo/subtitle-player/serve.py)，因为它支持正确的 MIME 类型和 MP4 Range 跳转
