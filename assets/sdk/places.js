/*! WinWidget places: where a weather-type widget is. Used by the built-in weather widgets with
    <script src="/__fw/places.js"></script>; needs "network:geocoding-api.open-meteo.com" and, for
    locating by network, "network:get.geojs.io".

    places.locate("台中")  → { name: "台中", lat, lon, tz }   (the name as the user typed it)
    places.locate("")      → the network's location, named in the user's language
    Results are kept in widget.storage, so a city is looked up once. */
(function () {
  "use strict";

  /** Thrown when a city can't be found; its message is ready to show. */
  class NotFound extends Error {}

  // Open-Meteo's city search only knows some Chinese names, and two-character names must match
  // exactly ("台中" finds nothing, "高雄" finds a village). Common cities go by their English name.
  const ALIASES = {
    // Taiwan
    "台北": "Taipei", "臺北": "Taipei", "新北": "New Taipei", "桃園": "Taoyuan", "桃园": "Taoyuan",
    "台中": "Taichung", "臺中": "Taichung", "台南": "Tainan", "臺南": "Tainan", "高雄": "Kaohsiung",
    "基隆": "Keelung", "新竹": "Hsinchu", "嘉義": "Chiayi", "嘉义": "Chiayi", "彰化": "Changhua",
    "屏東": "Pingtung", "屏东": "Pingtung", "宜蘭": "Yilan", "宜兰": "Yilan", "花蓮": "Hualien", "花莲": "Hualien",
    "台東": "Taitung", "臺東": "Taitung", "台东": "Taitung", "苗栗": "Miaoli", "南投": "Nantou", "斗六": "Douliu",
    "馬公": "Magong", "马公": "Magong", "金門": "Kinmen", "金门": "Kinmen",
    // Hong Kong, Macau, mainland China
    "香港": "Hong Kong", "澳門": "Macau", "澳门": "Macau",
    "北京": "Beijing", "上海": "Shanghai", "廣州": "Guangzhou", "广州": "Guangzhou", "深圳": "Shenzhen",
    "天津": "Tianjin", "重慶": "Chongqing", "重庆": "Chongqing", "成都": "Chengdu", "武漢": "Wuhan", "武汉": "Wuhan",
    "杭州": "Hangzhou", "南京": "Nanjing", "西安": "Xi'an", "蘇州": "Suzhou", "苏州": "Suzhou",
    "廈門": "Xiamen", "厦门": "Xiamen", "福州": "Fuzhou", "青島": "Qingdao", "青岛": "Qingdao",
    "大連": "Dalian", "大连": "Dalian", "瀋陽": "Shenyang", "沈阳": "Shenyang", "哈爾濱": "Harbin", "哈尔滨": "Harbin",
    "長沙": "Changsha", "长沙": "Changsha", "鄭州": "Zhengzhou", "郑州": "Zhengzhou", "濟南": "Jinan", "济南": "Jinan",
    "昆明": "Kunming", "南寧": "Nanning", "南宁": "Nanning", "貴陽": "Guiyang", "贵阳": "Guiyang",
    "蘭州": "Lanzhou", "兰州": "Lanzhou", "烏魯木齊": "Urumqi", "乌鲁木齐": "Urumqi", "拉薩": "Lhasa", "拉萨": "Lhasa",
    "合肥": "Hefei", "南昌": "Nanchang", "石家莊": "Shijiazhuang", "石家庄": "Shijiazhuang", "太原": "Taiyuan",
    "呼和浩特": "Hohhot", "長春": "Changchun", "长春": "Changchun", "海口": "Haikou", "三亞": "Sanya", "三亚": "Sanya",
    "西寧": "Xining", "西宁": "Xining", "銀川": "Yinchuan", "银川": "Yinchuan", "寧波": "Ningbo", "宁波": "Ningbo",
    "無錫": "Wuxi", "无锡": "Wuxi", "東莞": "Dongguan", "东莞": "Dongguan", "佛山": "Foshan", "珠海": "Zhuhai",
    "汕頭": "Shantou", "汕头": "Shantou",
    // elsewhere in Asia
    "東京": "Tokyo", "东京": "Tokyo", "大阪": "Osaka", "京都": "Kyoto", "橫濱": "Yokohama", "横滨": "Yokohama",
    "名古屋": "Nagoya", "札幌": "Sapporo", "福岡": "Fukuoka", "福冈": "Fukuoka", "那霸": "Naha", "沖繩": "Naha", "冲绳": "Naha",
    "神戶": "Kobe", "神户": "Kobe", "首爾": "Seoul", "首尔": "Seoul", "釜山": "Busan",
    "新加坡": "Singapore", "吉隆坡": "Kuala Lumpur", "檳城": "George Town", "槟城": "George Town",
    "曼谷": "Bangkok", "清邁": "Chiang Mai", "清迈": "Chiang Mai", "河內": "Hanoi", "河内": "Hanoi", "胡志明市": "Ho Chi Minh City",
    "馬尼拉": "Manila", "马尼拉": "Manila", "雅加達": "Jakarta", "雅加达": "Jakarta", "峇里島": "Denpasar", "巴厘岛": "Denpasar",
    "金邊": "Phnom Penh", "金边": "Phnom Penh", "仰光": "Yangon", "新德里": "New Delhi", "孟買": "Mumbai", "孟买": "Mumbai",
    "杜拜": "Dubai", "迪拜": "Dubai", "伊斯坦堡": "Istanbul", "伊斯坦布尔": "Istanbul",
    // Europe, the Americas, Oceania
    "倫敦": "London", "伦敦": "London", "巴黎": "Paris", "柏林": "Berlin", "羅馬": "Rome", "罗马": "Rome",
    "馬德里": "Madrid", "马德里": "Madrid", "巴塞隆納": "Barcelona", "巴塞罗那": "Barcelona", "阿姆斯特丹": "Amsterdam",
    "維也納": "Vienna", "维也纳": "Vienna", "蘇黎世": "Zurich", "苏黎世": "Zurich", "莫斯科": "Moscow", "布拉格": "Prague",
    "慕尼黑": "Munich", "法蘭克福": "Frankfurt", "法兰克福": "Frankfurt",
    "紐約": "New York", "纽约": "New York", "洛杉磯": "Los Angeles", "洛杉矶": "Los Angeles",
    "舊金山": "San Francisco", "旧金山": "San Francisco", "西雅圖": "Seattle", "西雅图": "Seattle", "芝加哥": "Chicago",
    "波士頓": "Boston", "波士顿": "Boston", "華盛頓": "Washington", "华盛顿": "Washington",
    "溫哥華": "Vancouver", "温哥华": "Vancouver", "多倫多": "Toronto", "多伦多": "Toronto", "檀香山": "Honolulu",
    "雪梨": "Sydney", "悉尼": "Sydney", "墨爾本": "Melbourne", "墨尔本": "Melbourne", "布里斯本": "Brisbane", "布里斯班": "Brisbane",
    "伯斯": "Perth", "珀斯": "Perth", "奧克蘭": "Auckland", "奥克兰": "Auckland",
  };

  const lang = /^zh/i.test(widget.locale) ? "zh" : "en";
  const cjk = /[㐀-鿿]/;

  async function json(url) {
    const r = await widget.fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  /** Every match for each spelling; the most populous one is almost always the city meant. */
  async function search(names) {
    const all = [];
    for (const name of names) {
      const g = await json(`https://geocoding-api.open-meteo.com/v1/search?count=10&language=${lang}&name=${encodeURIComponent(name)}`);
      all.push(...(g.results || []));
    }
    all.sort((a, b) => (b.population || 0) - (a.population || 0));
    return all[0] || null;
  }

  async function findCity(city) {
    const bare = city.replace(/[市縣县]$/, "");
    const names = ALIASES[bare] ? [ALIASES[bare]]
      : cjk.test(city) && bare === city ? [city, city + "市"] : [city];
    const r = await search(names);
    if (!r) {
      throw new NotFound(widget.t({ "zh-TW": `找不到城市「${city}」`, "zh-CN": `找不到城市“${city}”`, en: `City "${city}" not found` }));
    }
    return { name: city, lat: r.latitude, lon: r.longitude, tz: r.timezone };
  }

  async function findHere() {
    const g = await json("https://get.geojs.io/v1/ip/geo.json");
    const p = { name: g.city || g.region || "", lat: +g.latitude, lon: +g.longitude, tz: g.timezone };
    // The IP service answers in English; look the name up again in the user's language.
    if (lang !== "en" && p.name) {
      try {
        const g2 = await json(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=${lang}&name=${encodeURIComponent(p.name)}`);
        if (g2.results && g2.results[0]) p.name = g2.results[0].name;
      } catch { /* keep the English name */ }
    }
    return p;
  }

  /** The city from settings, or (empty) the network's location. Network locations are re-checked every 6 hours. */
  async function locate(city) {
    city = String(city || "").trim();
    const key = city ? `geo2:${city}` : "geo2:ip";
    const cached = await widget.storage.get(key);
    if (cached && (city || Date.now() - cached.at < 6 * 3600e3)) return cached;
    const p = city ? await findCity(city) : await findHere();
    p.at = Date.now();
    await widget.storage.set(key, p);
    return p;
  }

  window.places = Object.freeze({ locate, NotFound });
})();
