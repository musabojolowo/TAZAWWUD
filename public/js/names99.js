// ============================================================================
// TAZAWWUD — 99 Names of Allah (al-Asma al-Husna)
// ----------------------------------------------------------------------------
// Arabic, transliteration and English meaning for each name, in the widely
// published order that follows the narration in Jami' al-Tirmidhi (no. 3507).
// Source used: aswati.co/99-names-of-allah (fetched for this project).
//
// Detailed explanations are NOT included yet: no source we could verify
// reliably provided them, so none were written here.
// ============================================================================

import { escapeHtml } from "./html-utils.js";

// One name per line: "number. Arabic — transliteration — meaning"
const TABLE = `
1. الرَّحْمَٰن — Ar-Rahman — The Most Merciful
2. الرَّحِيم — Ar-Raheem — The Bestower of Mercy
3. الْمَلِك — Al-Malik — The King
4. الْقُدُّوس — Al-Quddus — The Most Holy
5. السَّلَام — As-Salam — The Source of Peace
6. الْمُؤْمِن — Al-Mu'min — The Granter of Security
7. الْمُهَيْمِن — Al-Muhaymin — The Guardian Over All
8. الْعَزِيز — Al-Aziz — The Almighty
9. الْجَبَّار — Al-Jabbar — The Compeller
10. الْمُتَكَبِّر — Al-Mutakabbir — The Supremely Great
11. الْخَالِق — Al-Khaliq — The Creator
12. الْبَارِئ — Al-Bari' — The Maker
13. الْمُصَوِّر — Al-Musawwir — The Fashioner
14. الْغَفَّار — Al-Ghaffar — The Constant Forgiver
15. الْقَهَّار — Al-Qahhar — The Subduer
16. الْوَهَّاب — Al-Wahhab — The Great Bestower
17. الرَّزَّاق — Ar-Razzaq — The Provider
18. الْفَتَّاح — Al-Fattah — The Opener
19. الْعَلِيم — Al-Aleem — The All-Knowing
20. الْقَابِض — Al-Qabid — The Withholder
21. الْبَاسِط — Al-Basit — The Extender
22. الْخَافِض — Al-Khafid — The Abaser
23. الرَّافِع — Ar-Rafi' — The Exalter
24. الْمُعِزّ — Al-Mu'izz — The Giver of Honour
25. الْمُذِلّ — Al-Mudhill — The Humbler
26. السَّمِيع — As-Samee' — The All-Hearing
27. الْبَصِير — Al-Baseer — The All-Seeing
28. الْحَكَم — Al-Hakam — The Judge
29. الْعَدْل — Al-Adl — The Utterly Just
30. اللَّطِيف — Al-Lateef — The Most Subtle and Kind
31. الْخَبِير — Al-Khabeer — The All-Aware
32. الْحَلِيم — Al-Haleem — The Most Forbearing
33. الْعَظِيم — Al-Azeem — The Magnificent
34. الْغَفُور — Al-Ghafoor — The Great Forgiver
35. الشَّكُور — Ash-Shakoor — The Most Appreciative
36. الْعَلِيّ — Al-Aliyy — The Most High
37. الْكَبِير — Al-Kabeer — The Most Great
38. الْحَفِيظ — Al-Hafeedh — The Preserver
39. الْمُقِيت — Al-Muqeet — The Sustainer
40. الْحَسِيب — Al-Haseeb — The Reckoner
41. الْجَلِيل — Al-Jaleel — The Majestic
42. الْكَرِيم — Al-Kareem — The Most Generous
43. الرَّقِيب — Ar-Raqeeb — The Ever-Watchful
44. الْمُجِيب — Al-Mujeeb — The Responsive
45. الْوَاسِع — Al-Wasi' — The All-Encompassing
46. الْحَكِيم — Al-Hakeem — The All-Wise
47. الْوَدُود — Al-Wadood — The Most Loving
48. الْمَجِيد — Al-Majeed — The Most Glorious
49. الْبَاعِث — Al-Ba'ith — The Resurrector
50. الشَّهِيد — Ash-Shaheed — The Witness Over All
51. الْحَقّ — Al-Haqq — The Absolute Truth
52. الْوَكِيل — Al-Wakeel — The Trustee
53. الْقَوِيّ — Al-Qawiyy — The All-Strong
54. الْمَتِين — Al-Mateen — The Firm
55. الْوَلِيّ — Al-Waliyy — The Protecting Friend
56. الْحَمِيد — Al-Hameed — The Praiseworthy
57. الْمُحْصِي — Al-Muhsi — The All-Enumerating
58. الْمُبْدِئ — Al-Mubdi' — The Originator
59. الْمُعِيد — Al-Mu'eed — The Restorer
60. الْمُحْيِي — Al-Muhyi — The Giver of Life
61. الْمُمِيت — Al-Mumeet — The Bringer of Death
62. الْحَيّ — Al-Hayy — The Ever-Living
63. الْقَيُّوم — Al-Qayyoom — The Self-Subsisting Sustainer
64. الْوَاجِد — Al-Wajid — The Perceiver
65. الْمَاجِد — Al-Majid — The Illustrious
66. الْوَاحِد — Al-Wahid — The One
67. الْأَحَد — Al-Ahad — The Unique
68. الصَّمَد — As-Samad — The Eternal Refuge
69. الْقَادِر — Al-Qadir — The All-Capable
70. الْمُقْتَدِر — Al-Muqtadir — The All-Powerful
71. الْمُقَدِّم — Al-Muqaddim — The Expediter
72. الْمُؤَخِّر — Al-Mu'akhkhir — The Delayer
73. الْأَوَّل — Al-Awwal — The First
74. الْآخِر — Al-Akhir — The Last
75. الظَّاهِر — Az-Zahir — The Manifest
76. الْبَاطِن — Al-Batin — The Hidden
77. الْوَالِي — Al-Wali — The Governor
78. الْمُتَعَالِي — Al-Muta'ali — The Self-Exalted
79. الْبَرّ — Al-Barr — The Source of Goodness
80. التَّوَّاب — At-Tawwab — The Acceptor of Repentance
81. الْمُنْتَقِم — Al-Muntaqim — The Just Requiter
82. الْعَفُوّ — Al-Afuww — The Pardoner
83. الرَّءُوف — Ar-Ra'oof — The Most Compassionate
84. مَالِكُ الْمُلْك — Malik-ul-Mulk — The Owner of All Sovereignty
85. ذُو الْجَلَالِ وَالْإِكْرَام — Dhul-Jalali wal-Ikram — The Possessor of Majesty and Honour
86. الْمُقْسِط — Al-Muqsit — The Equitable
87. الْجَامِع — Al-Jami' — The Gatherer
88. الْغَنِيّ — Al-Ghaniyy — The Self-Sufficient
89. الْمُغْنِي — Al-Mughni — The Enricher
90. الْمَانِع — Al-Mani' — The Preventer
91. الضَّارّ — Ad-Darr — The Distresser
92. النَّافِع — An-Nafi' — The Benefactor
93. النُّور — An-Nur — The Light
94. الْهَادِي — Al-Hadi — The Guide
95. الْبَدِيع — Al-Badi' — The Incomparable Originator
96. الْبَاقِي — Al-Baqi — The Everlasting
97. الْوَارِث — Al-Warith — The Inheritor of All
98. الرَّشِيد — Ar-Rasheed — The Guide to the Right Path
99. الصَّبُور — As-Saboor — The Most Patient
`;

export const NAMES_99 = TABLE.trim().split("\n").map((line) => {
  const match = line.match(/^(\d+)\.\s+(.+?)\s+—\s+(.+?)\s+—\s+(.+)$/);
  if (!match) throw new Error(`Malformed Names line: ${line}`);
  return { number: Number(match[1]), arabic: match[2], transliteration: match[3], meaning: match[4] };
});

function matches(name, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [name.transliteration, name.meaning, String(name.number)]
    .some((text) => text.toLowerCase().includes(q));
}

function render(root, query) {
  const visible = NAMES_99.filter((name) => matches(name, query));
  root.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">99 Names of Allah</h2>
      <p class="view-header__subtitle">Al-Asma al-Husna — the most beautiful names</p>
    </header>
    <label class="surah-search names99-search">
      <span class="material-symbols-rounded icon" aria-hidden="true">search</span>
      <input type="search" id="names99-search" placeholder="Search name or meaning…" autocomplete="off" value="${escapeHtml(query)}" />
    </label>
    <ol class="names99-list">
      ${visible.map((name) => `
        <li class="names99-item">
          <span class="names99-item__number">${name.number}</span>
          <span class="names99-item__ar" lang="ar" dir="rtl">${escapeHtml(name.arabic)}</span>
          <span class="names99-item__text">
            <span class="names99-item__translit">${escapeHtml(name.transliteration)}</span>
            <span class="names99-item__meaning">${escapeHtml(name.meaning)}</span>
          </span>
        </li>`).join("") || `<li class="stories-status">No names match "${escapeHtml(query)}".</li>`}
    </ol>
  `;
  const input = root.querySelector("#names99-search");
  input?.addEventListener("input", () => {
    const value = input.value;
    render(root, value);
    const next = root.querySelector("#names99-search");
    next?.focus();
    next?.setSelectionRange(value.length, value.length);
  });
}

export function initNames99(root) {
  if (!root) return;
  render(root, "");
}
