// v1.2590 (쪽 선택 전체 중앙 고정 — 행 단위 좌측 정렬 유지)
const API_URL = "https://script.google.com/macros/s/AKfycbwvdVkZm4EVUVeHaelSzQPrtFmOA2bB3A7HFMHEIbb42SbDFfNusYrsLyFbNakLmlMzcQ/exec";

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("chapter-container");

  try {
    const res = await fetch(`${API_URL}?page=${page}`);
    const data = await res.json();

    // 모든 페이지 번호 모으기
    const allPages = new Set();
    Object.values(data).forEach(q => {
      if (q.page) allPages.add(Number(q.page));
    });

    const sortedPages = Array.from(allPages).sort((a, b) => a - b);

    // 가장 긴 쪽 번호 기준으로 폭 계산
    const maxLen = Math.max(...sortedPages.map(p => String(p).length)) + 1; // "쪽" 포함
    const btnWidth = `${maxLen * 14 + 20}px`;

    // 10쪽 단위로 묶기
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

    // ✅ <div class="chapter-inner"> 로 감싸기
    const innerHTML =
      `<div class="chapter-inner">` +
      rows
        .map(
          row =>
            `<div class="page-row">${row
              .map(
                p =>
                  `<button class="page-btn" style="width:${btnWidth}" onclick="location.href='main.html?page=${p}'">${p}쪽</button>`
              )
              .join("")}</div>`
        )
        .join("") +
      `</div>`;

    container.innerHTML = innerHTML;
  } catch (err) {
    container.innerHTML = `<p style="color:red;">데이터를 불러오지 못했습니다.</p>`;
  }
});
