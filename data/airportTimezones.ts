/**
 * @file data/airportTimezones.ts
 * @description Offline ICAO → UTC offset dictionary for the CAAC Digital Logbook.
 *
 * PRD §2.3 requirement: "App 需本地打包一份《全球主要机场 ICAO 对应时区字典(JSON)》，
 * 确保断网时输入的当地时间 (LT) 能精准转换为 UTC 落盘。"
 *
 * Format: ICAO (uppercase, 4-char) → UTC offset in signed INTEGER minutes.
 *   Positive = East of UTC  (e.g. Beijing UTC+8 → +480)
 *   Negative = West of UTC  (e.g. New York UTC-5 → -300)
 *
 * Note on DST: China, Hong Kong, Macau, and most Gulf states do NOT observe DST,
 * so their offsets are fixed. For DST-observing regions (Europe, North America,
 * Australia) the offset here represents Standard Time. The UI should prompt the
 * pilot to confirm the offset when flying to DST-observing areas.
 *
 * Coverage targets:
 *   - All CAAC-regulated Chinese domestic airports (primary)
 *   - Major Asian hubs (secondary)
 *   - Common international destinations for Chinese carriers (tertiary)
 */

// ─── Type Definition ──────────────────────────────────────────────────────────

/** UTC offset in signed integer minutes. */
type UtcOffsetMinutes = number;

// ─── Airport Timezone Dictionary ─────────────────────────────────────────────

/**
 * Static offline dictionary of ICAO → UTC offset (minutes).
 * Keys are always 4-character uppercase ICAO codes.
 */
const AIRPORT_TIMEZONES: Readonly<Record<string, UtcOffsetMinutes>> = {

    // ── 中国大陆 (China Mainland) — UTC+8 (+480) ─────────────────────────────

    // 华北 North China
    ZBAA: 480,   // 北京首都 Beijing Capital
    ZBAD: 480,   // 北京大兴 Beijing Daxing
    ZBTJ: 480,   // 天津滨海 Tianjin Binhai
    ZBSJ: 480,   // 石家庄正定 Shijiazhuang Zhengding
    ZBTL: 480,   // 张家口宁远 Zhangjiakou Ningyuan
    ZBHH: 480,   // 呼和浩特白塔 Hohhot Baita

    // 东北 Northeast China
    ZYYY: 480,   // 沈阳桃仙 Shenyang Taoxian
    ZYTL: 480,   // 大连周水子 Dalian Zhoushuizi
    ZYCC: 480,   // 长春龙嘉 Changchun Longjia
    ZYHB: 480,   // 哈尔滨太平 Harbin Taiping

    // 华东 East China
    ZSSS: 480,   // 上海虹桥 Shanghai Hongqiao
    ZSPD: 480,   // 上海浦东 Shanghai Pudong
    ZSNJ: 480,   // 南京禄口 Nanjing Lukou
    ZSHC: 480,   // 杭州萧山 Hangzhou Xiaoshan
    ZSNB: 480,   // 宁波栎社 Ningbo Lishe
    ZSOF: 480,   // 合肥新桥 Hefei Xinqiao
    ZSFZ: 480,   // 福州长乐 Fuzhou Changle
    ZSAM: 480,   // 厦门高崎 Xiamen Gaoqi
    ZSJN: 480,   // 济南遥墙 Jinan Yaoqiang
    ZSQD: 480,   // 青岛流亭 Qingdao Liuting
    ZSYT: 480,   // 烟台莱山 Yantai Laishan
    ZSWZ: 480,   // 温州龙湾 Wenzhou Longwan

    // 华南 South China
    ZGGG: 480,   // 广州白云 Guangzhou Baiyun
    ZGSZ: 480,   // 深圳宝安 Shenzhen Bao'an
    ZGNN: 480,   // 南宁吴圩 Nanning Wuxu
    ZGHA: 480,   // 长沙黄花 Changsha Huanghua
    ZGSY: 480,   // 三亚凤凰 Sanya Phoenix

    // 西南 Southwest China
    ZUCK: 480,   // 重庆江北 Chongqing Jiangbei
    ZUUU: 480,   // 成都双流 Chengdu Shuangliu
    ZUTF: 480,   // 成都天府 Chengdu Tianfu
    ZPPP: 480,   // 昆明长水 Kunming Changshui
    ZULS: 480,   // 拉萨贡嘎 Lhasa Gonggar — note: Tibet uses Beijing time (UTC+8) officially
    ZUGU: 480,   // 贵阳龙洞堡 Guiyang Longdongbao

    // 华中 Central China
    ZHHH: 480,   // 武汉天河 Wuhan Tianhe
    ZHCC: 480,   // 郑州新郑 Zhengzhou Xinzheng
    ZSNC: 480,   // 南昌昌北 Nanchang Changbei

    // 西北 Northwest China — UTC+8 (official Beijing time)
    ZLXY: 480,   // 西安咸阳 Xi'an Xianyang
    ZLLL: 480,   // 兰州中川 Lanzhou Zhongchuan
    ZWWW: 480,   // 乌鲁木齐地窝堡 Ürümqi Diwopu — note: geographic UTC+6 but uses Beijing time
    ZWNL: 480,   // 那拉提 Nalati
    ZLHZ: 480,   // 西宁曹家堡 Xining Caojiabu

    // ── 中国港澳台 (HK / Macau / Taiwan) ────────────────────────────────────────

    VHHH: 480,   // 香港赤鱲角 Hong Kong International (UTC+8, no DST)
    VMMC: 480,   // 澳门 Macau International (UTC+8, no DST)
    RCTP: 480,   // 台湾桃园 Taiwan Taoyuan (UTC+8, no DST)
    RCSS: 480,   // 台北松山 Taipei Songshan

    // ── 东亚 East Asia ───────────────────────────────────────────────────────────

    // Japan — UTC+9 (+540), no DST
    RJTT: 540,   // 东京羽田 Tokyo Haneda
    RJAA: 540,   // 东京成田 Tokyo Narita
    RJBB: 540,   // 大阪关西 Osaka Kansai
    RJOO: 540,   // 大阪伊丹 Osaka Itami
    RJCC: 540,   // 北海道新千岁 Hokkaido New Chitose
    RJFF: 540,   // 福冈 Fukuoka

    // South Korea — UTC+9 (+540), no DST
    RKSI: 540,   // 首尔仁川 Seoul Incheon
    RKSS: 540,   // 首尔金浦 Seoul Gimpo
    RKPK: 540,   // 釜山金海 Busan Gimhae

    // ── 东南亚 Southeast Asia ────────────────────────────────────────────────────

    // Singapore — UTC+8 (+480), no DST
    WSSS: 480,   // 新加坡樟宜 Singapore Changi

    // Thailand — UTC+7 (+420), no DST
    VTBS: 420,   // 曼谷素万那普 Bangkok Suvarnabhumi
    VTBD: 420,   // 曼谷廊曼 Bangkok Don Mueang
    VTSP: 420,   // 普吉岛 Phuket

    // Vietnam — UTC+7 (+420), no DST
    VVNB: 420,   // 河内内排 Hanoi Noi Bai
    VVTS: 420,   // 胡志明市新山一 Ho Chi Minh Tan Son Nhat

    // Malaysia — UTC+8 (+480), no DST
    WMKK: 480,   // 吉隆坡 Kuala Lumpur
    WMKP: 480,   // 槟城 Penang

    // Indonesia — UTC+7 (+420) / UTC+8 (+480) / UTC+9 (+540)
    WIII: 420,   // 雅加达苏加诺-哈达 Jakarta Soekarno-Hatta (WIB UTC+7)
    WADD: 480,   // 巴厘岛恩古拉赖 Bali Ngurah Rai (WITA UTC+8)

    // Philippines — UTC+8 (+480), no DST
    RPLL: 480,   // 马尼拉尼诺伊·阿基诺 Manila Ninoy Aquino

    // Cambodia — UTC+7 (+420), no DST
    VDPP: 420,   // 金边 Phnom Penh

    // ── 南亚 South Asia ──────────────────────────────────────────────────────────

    // India — UTC+5:30 (+330), no DST
    VIDP: 330,   // 新德里英迪拉甘地 Delhi Indira Gandhi
    VABB: 330,   // 孟买查特拉帕蒂·希瓦吉 Mumbai
    VOBL: 330,   // 班加罗尔 Bengaluru

    // Nepal — UTC+5:45 (+345)
    VNKT: 345,   // 加德满都特里布万 Kathmandu Tribhuvan

    // Pakistan — UTC+5 (+300), no DST
    OPKC: 300,   // 卡拉奇真纳 Karachi Jinnah
    OPLR: 300,   // 伊斯兰堡班纳齐尔·布托 Islamabad

    // Sri Lanka — UTC+5:30 (+330)
    VCBI: 330,   // 科伦坡班达拉奈克 Colombo Bandaranaike

    // ── 中东 Middle East ─────────────────────────────────────────────────────────

    // UAE — UTC+4 (+240), no DST
    OMDB: 240,   // 迪拜 Dubai International
    OMAA: 240,   // 阿布扎比 Abu Dhabi
    OMSJ: 240,   // 沙迦 Sharjah

    // Qatar — UTC+3 (+180), no DST
    OTHH: 180,   // 多哈哈马德 Doha Hamad

    // Saudi Arabia — UTC+3 (+180), no DST
    OERK: 180,   // 利雅得法赫德国王 Riyadh King Fahd
    OEJN: 180,   // 吉达阿卜杜勒阿齐兹国王 Jeddah
    OEMA: 180,   // 麦地那 Madinah

    // Kuwait — UTC+3 (+180), no DST
    OKBK: 180,   // 科威特 Kuwait

    // Israel — UTC+2 (+120) standard / UTC+3 (+180) summer (DST)
    LLBG: 120,   // 特拉维夫本·古里安 Tel Aviv Ben Gurion (Standard Time)

    // ── 欧洲 Europe ──────────────────────────────────────────────────────────────
    // Note: All European airports observe DST. Offsets below = Standard Time (winter).

    // UK — UTC+0 (GMT) standard
    EGLL: 0,     // 伦敦希思罗 London Heathrow
    EGKK: 0,     // 伦敦盖特威克 London Gatwick
    EGCC: 0,     // 曼彻斯特 Manchester

    // Germany — UTC+1 (+60) standard
    EDDF: 60,    // 法兰克福 Frankfurt
    EDDM: 60,    // 慕尼黑 Munich
    EDDB: 60,    // 柏林勃兰登堡 Berlin Brandenburg

    // France — UTC+1 (+60) standard
    LFPG: 60,    // 巴黎戴高乐 Paris CDG
    LFPO: 60,    // 巴黎奥利 Paris Orly

    // Netherlands — UTC+1 (+60) standard
    EHAM: 60,    // 阿姆斯特丹史基浦 Amsterdam Schiphol

    // Switzerland — UTC+1 (+60) standard
    LSZH: 60,    // 苏黎世 Zurich

    // Italy — UTC+1 (+60) standard
    LIRF: 60,    // 罗马菲乌米奇诺 Rome Fiumicino
    LIMC: 60,    // 米兰马尔彭萨 Milan Malpensa

    // Spain — UTC+1 (+60) standard
    LEMD: 60,    // 马德里巴拉哈斯 Madrid Barajas
    LEBL: 60,    // 巴塞罗那 Barcelona

    // Russia — Moscow UTC+3 (+180), no DST since 2014
    UUEE: 180,   // 莫斯科谢列梅捷沃 Moscow Sheremetyevo
    UUDD: 180,   // 莫斯科多莫杰多沃 Moscow Domodedovo
    ULLI: 180,   // 圣彼得堡普尔科沃 St. Petersburg Pulkovo

    // ── 北美 North America ───────────────────────────────────────────────────────
    // Note: All listed airports observe DST. Offsets below = Standard Time (winter).

    // USA East — UTC-5 (-300) standard
    KJFK: -300,  // 纽约肯尼迪 New York JFK
    KEWR: -300,  // 纽约纽瓦克 Newark
    KLAX: -480,  // 洛杉矶 Los Angeles (UTC-8 PST)
    KSFO: -480,  // 旧金山 San Francisco (UTC-8 PST)
    KORD: -360,  // 芝加哥奥黑尔 Chicago O'Hare (UTC-6 CST)
    KATL: -300,  // 亚特兰大 Atlanta (UTC-5 EST)
    KSEA: -480,  // 西雅图 Seattle-Tacoma (UTC-8 PST)

    // Canada
    CYVR: -480,  // 温哥华 Vancouver (UTC-8 PST)
    CYYZ: -300,  // 多伦多皮尔逊 Toronto Pearson (UTC-5 EST)

    // ── 大洋洲 Oceania ───────────────────────────────────────────────────────────

    // Australia — AEST UTC+10 (+600) standard
    YSSY: 600,   // 悉尼金斯福德·史密斯 Sydney Kingsford Smith
    YMML: 600,   // 墨尔本 Melbourne (AEDT UTC+11 in summer — Standard Time here)
    YBBN: 600,   // 布里斯班 Brisbane (no DST, always UTC+10)
    YPPH: 480,   // 珀斯 Perth (AWST UTC+8, no DST)

    // New Zealand — NZST UTC+12 (+720) standard
    NZAA: 720,   // 奥克兰 Auckland
    NZCH: 720,   // 基督城 Christchurch

} as const;

// ─── Public Lookup Function ───────────────────────────────────────────────────

/**
 * Looks up the UTC offset for an airport by ICAO code.
 *
 * Returns the offset in signed integer minutes, or `null` if the airport is
 * not in the local dictionary (caller should then prompt the pilot for manual
 * UTC offset entry).
 *
 * @param icao - 4-character ICAO airport code. Case-insensitive.
 * @returns UTC offset in minutes, or null if not found.
 *
 * @example
 * lookupAirportOffset('ZBAA')         // → 480   (Beijing UTC+8)
 * lookupAirportOffset('EGLL')         // → 0     (London UTC+0)
 * lookupAirportOffset('zbaa')         // → 480   (case-insensitive)
 * lookupAirportOffset('ZZZZ')         // → 480   (unknown airport, returns fallback)
 * lookupAirportOffset('ZZZZ', -300)   // → -300  (custom fallback for unknown airport)
 */
export function lookupAirportOffset(
    icao: string,
    fallback: UtcOffsetMinutes = 480,
): UtcOffsetMinutes {
    const key = icao.toUpperCase().trim();
    if (key.length !== 4) return fallback;
    const result = AIRPORT_TIMEZONES[key];
    return result !== undefined ? result : fallback;
}

/**
 * Returns a sorted list of all ICAO codes in the local dictionary.
 * Useful for autocomplete / typeahead in the airport input field.
 */
export function listKnownAirports(): string[] {
    return Object.keys(AIRPORT_TIMEZONES).sort();
}

export { AIRPORT_TIMEZONES };
export type { UtcOffsetMinutes };
