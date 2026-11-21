import QtQuick

// A store preview: the picture at `url`, fetched by the app (App.preview) into
// its cache and shown from the file there. Qt is never given the URL: it
// would load whatever the store sends, of any size, into the shell.
Image {
  id: img

  required property var app
  property string url: ""

  fillMode: Image.PreserveAspectFit
  // Read at no more than this wide, whatever the file's own size.
  sourceSize.width: 960
  asynchronous: true
  smooth: true

  onUrlChanged: img.load()
  Component.onCompleted: img.load()

  function load() {
    var want = img.url
    img.source = ""
    if (want) img.app.preview(want, function(file) { if (img.url === want) img.source = file })
  }
}
