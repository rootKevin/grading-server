const API_URL = "https://grading-server-production.up.railway.app";

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("chapter-container");

  try {
    const res = await fetch(`${API_URL}/pages`);
    const pages = await res.json();   // <-- 배열로 받아야 함

    if (!Array.isArray(pages) || pages.length === 0) {
      container.innerHTML = `<p style="color:red;">페이지 데이터가 없습니다.</p>`;
      return;
    }

    const sortedPages = pages.sort((a, b) => a - b);

    const maxLen = Math.max(...sortedPages.map(p => String(p).length)) + 1;
    const btnWidth = `${maxLen * 14 + 20}px`;

    const rows = [];
    let currentRow = [];
    let currentBase = Math.floor(sortedPages[0] / 10);

    sortedPages.forEach(p => {
      const base = Math.floor(p / 10);
      if (base !== currentBase && currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
        currentBase = base;
      }
      currentRow.push(p);
    });
    if (currentRow.length) rows.push(currentRow);

    const innerHTML =
      `<div class="chapter-inner">` +
      rows
        .map(
          row =>
            `<div class="page-row">${row
              .map(
                p =>
                  `<button class="page-btn" style="width:${btnWidth}" onclick="location.href='grading.html?page=${p}'">${p}쪽</button>`
              )
              .join("")}</div>`
        )
        .join("") +
      `</div>`;

    container.innerHTML = innerHTML;

  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color:red;">데이터를 불러오지 못했습니다.</p>`;
  }
});
