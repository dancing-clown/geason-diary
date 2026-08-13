(function () {
  "use strict";

  var parts = document.querySelectorAll("#sidebar .part-title");
  parts.forEach(function (part) {
    var links = [];
    var node = part.parentElement.nextElementSibling;
    while (node && !node.classList.contains("part-title") && !node.classList.contains("part-title")) {
      if (node.querySelector("a")) links.push(node.querySelector("a"));
      node = node.nextElementSibling;
    }
    part.setAttribute("data-count", String(links.length).padStart(2, "0"));
  });

  document.querySelectorAll("pre > code").forEach(function (code) {
    var block = code.parentElement;
    block.style.position = "relative";
    var button = document.createElement("button");
    button.className = "copy-code";
    button.type = "button";
    button.textContent = "复制";
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(code.innerText).then(function () {
        button.textContent = "已复制";
        window.setTimeout(function () { button.textContent = "复制"; }, 1400);
      });
    });
    block.appendChild(button);
  });
}());
