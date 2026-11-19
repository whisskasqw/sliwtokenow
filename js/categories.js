// Категории и правила сопоставления классов ImageNet (индексы 0–999) с ними.

export const CATEGORIES = [
  { id: 'people',    name: 'Люди',              icon: '👤', color: '#f59e0b' },
  { id: 'animals',   name: 'Животные',          icon: '🐾', color: '#ef4444' },
  { id: 'nature',    name: 'Природа',           icon: '🌿', color: '#22c55e' },
  { id: 'food',      name: 'Еда и напитки',     icon: '🍽️', color: '#f97316' },
  { id: 'city',      name: 'Город и архитектура', icon: '🏛️', color: '#a78bfa' },
  { id: 'transport', name: 'Транспорт',         icon: '🚗', color: '#3b82f6' },
  { id: 'tech',      name: 'Техника',           icon: '💻', color: '#06b6d4' },
  { id: 'docs',      name: 'Документы и скриншоты', icon: '📄', color: '#94a3b8' },
  { id: 'other',     name: 'Другое',            icon: '📦', color: '#78716c' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const RULES = {
  animals: range(0, 397).filter(i => i !== 108), // 108 sea anemone — часто путается с цветами
  food: [
    ...range(923, 957), ...range(959, 969), 987, 998, 415, 504, 505, 509, 550, 567, 572, 659, 809,
    440, 441, 907, 901, 899, 849, 891, 909, 766,
  ],
  nature: [...range(970, 980), ...range(984, 986), ...range(988, 997), 958, 672, 815, 599, 738, 989, 580, 108],
  people: [
    981, 982, 983, 399, 400, 411, 433, 445, 451, 452, 457, 459, 474, 501, 514,
    515, 518, 552, 568, 578, 601, 608, 610, 614, 617, 638, 639, 652,
    655, 689, 697, 735, 775, 796, 808, 824, 834, 836, 837, 841, 842, 869, 887,
    903, 906,
  ],
  transport: [
    403, 404, 405, 407, 408, 436, 444, 466, 468, 472, 475, 479, 484, 510, 511,
    535, 547, 554, 555, 561, 565, 569, 573, 575, 576, 581, 586, 595, 603, 609,
    612, 625, 627, 628, 654, 656, 660, 661, 665, 670, 671, 675, 690, 705, 717,
    734, 751, 757, 779, 780, 802, 803, 812, 814, 817, 820, 829, 833, 847, 864,
    866, 867, 870, 871, 874, 880, 895, 908, 913, 914, 450, 537, 694, 701,
  ],
  city: [
    406, 410, 421, 424, 425, 437, 442, 449, 454, 460, 467, 483, 489, 497, 498,
    500, 517, 525, 536, 538, 540, 557, 562, 571, 580, 582, 624, 634, 637, 640,
    649, 663, 668, 682, 698, 703, 704, 706, 707, 716, 718, 727, 743, 762, 788,
    821, 825, 832, 839, 853, 858, 860, 863, 865, 873, 888, 900, 912, 915, 919,
    920, 476, 877,
  ],
  tech: [
    482, 485, 487, 508, 527, 528, 590, 592, 598, 605, 620, 622, 632, 662, 664,
    673, 681, 713, 732, 742, 745, 754, 759, 761, 782, 810, 851, 878, 613, 650,
    688, 755, 807, 481, 848,
  ],
  docs: [916, 917, 918, 921, 922, 446, 549, 553, 611],
};

// индекс класса -> id категории
export const CLASS_TO_CATEGORY = new Map();
for (const [cat, list] of Object.entries(RULES)) {
  for (const idx of list) CLASS_TO_CATEGORY.set(idx, cat);
}

// Классы детектора объектов COCO-SSD -> категория
export const COCO_TO_CATEGORY = {
  person: 'people',
  bicycle: 'transport', car: 'transport', motorcycle: 'transport', airplane: 'transport',
  bus: 'transport', train: 'transport', truck: 'transport', boat: 'transport',
  'traffic light': 'city', 'fire hydrant': 'city', 'stop sign': 'city',
  'parking meter': 'city', bench: 'city',
  bird: 'animals', cat: 'animals', dog: 'animals', horse: 'animals', sheep: 'animals',
  cow: 'animals', elephant: 'animals', bear: 'animals', zebra: 'animals', giraffe: 'animals',
  banana: 'food', apple: 'food', sandwich: 'food', orange: 'food', broccoli: 'food',
  carrot: 'food', 'hot dog': 'food', pizza: 'food', donut: 'food', cake: 'food',
  'wine glass': 'food', cup: 'food', bowl: 'food',
  tv: 'tech', laptop: 'tech', mouse: 'tech', remote: 'tech', keyboard: 'tech',
  'cell phone': 'tech',
  book: 'docs',
};
