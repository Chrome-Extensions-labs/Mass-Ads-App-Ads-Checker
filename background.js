chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: "index.html",
    type: "popup",
    width: 1200,
    height: 800,
    top: 100,
    left: 400
  });
});
