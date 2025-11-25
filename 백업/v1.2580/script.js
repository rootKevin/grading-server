const API_URL = "https://script.google.com/macros/s/AKfycbwvdVkZm4EVUVeHaelSzQPrtFmOA2bB3A7HFMHEIbb42SbDFfNusYrsLyFbNakLmlMzcQ/exec";

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("chapter-container");
  if (!container) return; // main.html 방지
  container.innerHTML = "<p>📡 불러오는 중...</p>";

  try {
    const res = await fetch(API_URL);
    const data = await res.json();

    const chapters = {};
    Object.values(data).forEach(q => {
      const chap = q.chapter || "기타";
      if (!chapters[chap]) chapters[chap] = new Set();
      chapters[chap].add(q.page);
    });

    container.innerHTML = "";

    Object.keys(chapters).forEach(chap => {
      const section = document.createElement("div");
      section.className = "chapter-section";

      const title = document.createElement("h2");
      title.textContent = chap;
      section.appendChild(title);

      const pagesDiv = document.createElement("div");
      pagesDiv.className = "page-grid";

      Array.from(chapters[chap])
        .sort((a, b) => a - b)
        .forEach(page => {
          const btn = document.createElement("button");
          btn.textContent = `${page}쪽`;
          btn.className = "page-btn";
          btn.onclick = () => {
            window.location.href = `main.html?page=${page}`;
          };
          pagesDiv.appendChild(btn);
        });

      section.appendChild(pagesDiv);
      container.appendChild(section);
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="color:red;">❌ 데이터 로드 실패</p>`;
  }
});
