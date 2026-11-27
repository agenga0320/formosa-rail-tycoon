'use strict';
/* 寶島鐵道大亨 — 地圖與遊戲資料
 * 物件格式：[名稱, 價格(萬元), 年收益率(%), 類型]
 * 類型：food 美食 / agri 農產 / tour 觀光 / ind 產業
 * lab：站名標籤位置 t上 b下 l左 r右；shop：有卡片商店
 */
const STATIONS = [
  { id: 'keelung', name: '基隆', lon: 121.72, lat: 25.15, lab: 't', props: [
    ['廟口鼎邊趖', 800, 50, 'food'], ['營養三明治', 1000, 40, 'food'], ['和平島公園', 5000, 10, 'tour'], ['基隆港貨櫃碼頭', 30000, 6, 'ind']] },
  { id: 'ruifang', name: '瑞芳', lon: 121.84, lat: 25.09, lab: 't', props: [
    ['九份芋圓', 1000, 40, 'food'], ['九份老街茶樓', 3000, 20, 'tour'], ['猴硐貓村', 2000, 15, 'tour'], ['金瓜石黃金博物館', 8000, 8, 'tour']] },
  { id: 'fulong', name: '福隆', lon: 121.94, lat: 25.01, lab: 'r', props: [
    ['福隆便當', 1000, 45, 'food'], ['草嶺古道', 2000, 15, 'tour'], ['福隆海水浴場', 5000, 12, 'tour']] },
  { id: 'taipei', name: '台北', lon: 121.52, lat: 25.05, lab: 't', shop: true, props: [
    ['珍珠奶茶店', 2000, 30, 'food'], ['牛肉麵老店', 3000, 25, 'food'], ['士林夜市攤位', 5000, 20, 'food'], ['西門町百貨', 30000, 8, 'ind'], ['摩天大樓觀景台', 100000, 4, 'tour']] },
  { id: 'banqiao', name: '板橋', lon: 121.40, lat: 24.98, lab: 'b', props: [
    ['林家花園茶館', 3000, 15, 'tour'], ['鶯歌陶瓷工坊', 5000, 12, 'ind'], ['府中商圈', 8000, 10, 'ind']] },
  { id: 'taoyuan', name: '桃園', lon: 121.25, lat: 24.96, lab: 'l', props: [
    ['大溪豆乾', 1000, 40, 'food'], ['石門活魚', 3000, 20, 'food'], ['物流園區', 20000, 7, 'ind'], ['機場免稅店', 50000, 6, 'ind']] },
  { id: 'hsinchu', name: '新竹', lon: 120.97, lat: 24.80, lab: 'l', shop: true, props: [
    ['新竹米粉', 1000, 40, 'food'], ['城隍廟小吃', 2000, 30, 'food'], ['貢丸工廠', 3000, 25, 'food'], ['科學園區晶圓廠', 200000, 5, 'ind']] },
  { id: 'zhunan', name: '竹南', lon: 120.88, lat: 24.69, lab: 'r', props: [
    ['竹南蛇窯', 2000, 15, 'tour'], ['龍鳳宮香舖', 1500, 15, 'tour']] },
  { id: 'miaoli', name: '苗栗', lon: 120.82, lat: 24.57, lab: 'r', props: [
    ['客家擂茶', 1000, 40, 'food'], ['大湖草莓園', 2000, 35, 'agri'], ['龍騰斷橋', 3000, 10, 'tour'], ['三義木雕街', 4000, 12, 'tour']] },
  { id: 'dajia', name: '大甲', lon: 120.62, lat: 24.35, lab: 'l', props: [
    ['芋頭酥老店', 1000, 40, 'food'], ['鎮瀾宮香舖', 3000, 20, 'tour'], ['高美濕地', 5000, 10, 'tour']] },
  { id: 'fengyuan', name: '豐原', lon: 120.74, lat: 24.25, lab: 'r', props: [
    ['豐原糕餅', 1500, 35, 'food'], ['廟東夜市', 2000, 30, 'food'], ['后里花卉', 3000, 25, 'agri']] },
  { id: 'taichung', name: '台中', lon: 120.69, lat: 24.14, lab: 'r', shop: true, props: [
    ['太陽餅老店', 1500, 35, 'food'], ['手搖飲連鎖', 5000, 25, 'food'], ['逢甲夜市', 8000, 15, 'food'], ['國家歌劇院', 30000, 5, 'tour'], ['精密機械園區', 50000, 6, 'ind']] },
  { id: 'changhua', name: '彰化', lon: 120.54, lat: 24.08, lab: 'l', props: [
    ['彰化肉圓', 1000, 40, 'food'], ['鹿港蚵仔煎', 1500, 35, 'food'], ['田尾花卉', 2000, 30, 'agri'], ['扇形車庫', 4000, 10, 'tour']] },
  { id: 'ershui', name: '二水', lon: 120.62, lat: 23.81, lab: 'l', props: [
    ['二水白柚', 1500, 30, 'agri'], ['鐵道公園', 1000, 15, 'tour']] },
  { id: 'jiji', name: '集集', lon: 120.78, lat: 23.83, lab: 'b', props: [
    ['集集香蕉', 1000, 40, 'agri'], ['綠色隧道單車', 2000, 15, 'tour']] },
  { id: 'checheng', name: '車埕', lon: 120.93, lat: 23.87, lab: 'r', props: [
    ['日月潭紅茶', 3000, 30, 'agri'], ['湖上遊艇', 10000, 10, 'tour'], ['原住民文化園區', 20000, 7, 'tour'], ['湖畔度假村', 50000, 5, 'tour']] },
  { id: 'douliu', name: '斗六', lon: 120.54, lat: 23.71, lab: 'l', props: [
    ['斗六文旦', 1500, 30, 'agri'], ['古坑咖啡', 2000, 35, 'agri'], ['西螺醬油', 3000, 25, 'food']] },
  { id: 'chiayi', name: '嘉義', lon: 120.44, lat: 23.48, lab: 'l', shop: true, props: [
    ['雞肉飯', 1000, 45, 'food'], ['方塊酥', 1500, 35, 'food'], ['文化路夜市', 3000, 25, 'food']] },
  { id: 'alishan', name: '阿里山', lon: 120.80, lat: 23.51, lab: 'r', props: [
    ['奮起湖便當', 1500, 40, 'food'], ['山葵田', 2000, 25, 'agri'], ['高山茶園', 5000, 30, 'agri'], ['森林鐵路觀光', 20000, 8, 'tour']] },
  { id: 'xinying', name: '新營', lon: 120.32, lat: 23.31, lab: 'l', props: [
    ['鹽水意麵', 1000, 40, 'food'], ['糖廠冰品', 1500, 35, 'food'], ['井仔腳鹽田', 2000, 15, 'tour']] },
  { id: 'tainan', name: '台南', lon: 120.21, lat: 23.00, lab: 'l', shop: true, props: [
    ['安平豆花', 1000, 45, 'food'], ['擔仔麵', 1500, 40, 'food'], ['牛肉湯', 2000, 35, 'food'], ['赤崁文創', 5000, 12, 'tour'], ['南科光電廠', 100000, 5, 'ind']] },
  { id: 'kaohsiung', name: '高雄', lon: 120.30, lat: 22.63, lab: 'l', shop: true, props: [
    ['旗津海產', 2000, 35, 'food'], ['六合夜市', 3000, 30, 'food'], ['駁二藝術特區', 8000, 12, 'tour'], ['港口造船廠', 80000, 6, 'ind'], ['大鋼鐵廠', 150000, 5, 'ind']] },
  { id: 'pingtung', name: '屏東', lon: 120.49, lat: 22.67, lab: 't', props: [
    ['萬丹紅豆餅', 1000, 40, 'food'], ['屏東檸檬', 1500, 35, 'agri'], ['東港黑鮪魚', 8000, 20, 'food']] },
  { id: 'chaozhou', name: '潮州', lon: 120.54, lat: 22.55, lab: 'r', props: [
    ['燒冷冰', 1000, 45, 'food'], ['林邊蓮霧', 2000, 35, 'agri']] },
  { id: 'fangliao', name: '枋寮', lon: 120.59, lat: 22.37, lab: 'l', props: [
    ['枋山芒果', 2000, 35, 'agri'], ['枋寮漁港', 3000, 20, 'food']] },
  { id: 'kenting', name: '墾丁', lon: 120.80, lat: 21.97, lab: 'r', props: [
    ['恆春洋蔥', 1500, 35, 'agri'], ['墾丁大街', 5000, 20, 'food'], ['海景民宿', 10000, 12, 'tour'], ['海洋生物館', 30000, 7, 'tour']] },
  { id: 'dawu', name: '大武', lon: 120.89, lat: 22.34, lab: 'r', props: [
    ['達仁小米', 1000, 35, 'agri'], ['海景咖啡', 2000, 20, 'tour']] },
  { id: 'taitung', name: '台東', lon: 121.12, lat: 22.79, lab: 'r', shop: true, props: [
    ['台東釋迦', 1500, 40, 'agri'], ['離島潛水', 5000, 15, 'tour'], ['鹿野熱氣球', 8000, 12, 'tour'], ['知本溫泉', 10000, 10, 'tour']] },
  { id: 'chishang', name: '池上', lon: 121.22, lat: 23.12, lab: 'r', props: [
    ['池上便當', 2000, 40, 'food'], ['池上米', 3000, 30, 'agri'], ['稻田單車道', 3000, 15, 'tour']] },
  { id: 'yuli', name: '玉里', lon: 121.31, lat: 23.33, lab: 'r', props: [
    ['玉里麵', 1000, 45, 'food'], ['瑞穗鮮乳', 3000, 30, 'agri'], ['溪谷泛舟', 5000, 12, 'tour']] },
  { id: 'hualien', name: '花蓮', lon: 121.60, lat: 23.99, lab: 'r', shop: true, props: [
    ['花蓮麻糬', 1000, 45, 'food'], ['扁食老店', 1500, 40, 'food'], ['東大門夜市', 4000, 25, 'food'], ['石材工廠', 20000, 7, 'ind'], ['峽谷觀光', 30000, 8, 'tour']] },
  { id: 'suao', name: '蘇澳', lon: 121.84, lat: 24.60, lab: 'r', props: [
    ['南方澳鯖魚', 2000, 35, 'food'], ['蘇澳冷泉', 3000, 15, 'tour']] },
  { id: 'yilan', name: '宜蘭', lon: 121.75, lat: 24.75, lab: 'l', props: [
    ['三星蔥油餅', 1000, 45, 'food'], ['宜蘭鴨賞', 1500, 35, 'food'], ['金棗糕', 1500, 30, 'agri'], ['冬山河親水公園', 5000, 10, 'tour']] },
  { id: 'jiaoxi', name: '礁溪', lon: 121.78, lat: 24.87, lab: 'l', props: [
    ['溫泉蔬菜', 1500, 35, 'agri'], ['溫泉旅館', 15000, 10, 'tour']] },
];

/* 路線：兩站之間的中間格數依距離自動計算。bus:true 為公路客運（虛線） */
const LINES = [
  ['taipei', 'keelung'], ['keelung', 'ruifang'], ['ruifang', 'fulong'], ['fulong', 'jiaoxi'],
  ['jiaoxi', 'yilan'], ['yilan', 'suao'], ['suao', 'hualien'], ['hualien', 'yuli'],
  ['yuli', 'chishang'], ['chishang', 'taitung'], ['taitung', 'dawu'], ['dawu', 'fangliao'],
  ['fangliao', 'kenting', { bus: true }], ['fangliao', 'chaozhou'], ['chaozhou', 'pingtung'],
  ['pingtung', 'kaohsiung'], ['kaohsiung', 'tainan'], ['tainan', 'xinying'], ['xinying', 'chiayi'],
  ['chiayi', 'alishan'], ['chiayi', 'douliu'], ['douliu', 'ershui'], ['ershui', 'jiji'],
  ['jiji', 'checheng'], ['ershui', 'changhua'], ['changhua', 'taichung'], ['taichung', 'fengyuan'],
  ['fengyuan', 'miaoli'], ['changhua', 'dajia'], ['dajia', 'zhunan'], ['miaoli', 'zhunan'],
  ['zhunan', 'hsinchu'], ['hsinchu', 'taoyuan'], ['taoyuan', 'banqiao'], ['banqiao', 'taipei'],
];

/* 台灣本島輪廓（經度, 緯度），順時針 */
const COAST = [
  [121.54, 25.30], [121.75, 25.17], [121.92, 25.13], [122.01, 25.01], [121.87, 24.86],
  [121.88, 24.58], [121.80, 24.45], [121.70, 24.20], [121.63, 23.98], [121.52, 23.60],
  [121.40, 23.10], [121.19, 22.75], [120.92, 22.33], [120.86, 21.89], [120.73, 21.92],
  [120.70, 22.10], [120.58, 22.33], [120.45, 22.46], [120.25, 22.60], [120.12, 23.00],
  [120.06, 23.15], [120.13, 23.45], [120.19, 23.78], [120.38, 24.07], [120.49, 24.27],
  [120.63, 24.48], [120.82, 24.70], [120.90, 24.85], [121.05, 25.05], [121.30, 25.13],
  [121.42, 25.19],
];

/* 卡片 */
const CARDS = {
  express:   { name: '莒光號卡', kind: 'move', dice: 2, price: 500,  desc: '擲 2 顆骰子前進' },
  limited:   { name: '自強號卡', kind: 'move', dice: 3, price: 1500, desc: '擲 3 顆骰子前進' },
  hsr:       { name: '高鐵卡',   kind: 'move', dice: 4, price: 6000, desc: '擲 4 顆骰子前進' },
  warp:      { name: '瞬移卡',   kind: 'warp', price: 800,  desc: '隨機傳送到某個車站' },
  near:      { name: '導航卡',   kind: 'near', price: 0,    desc: '傳送到目的地附近 1～3 格；離島目的地則傳送至可前往該島的本島交通站' },
  stop:      { name: '停駛卡',   kind: 'stop', price: 1200, desc: '指定一名對手，下回合無法行動' },
  charm:     { name: '平安符',   kind: 'charm', price: 3000, desc: '趕走纏在身上的衰尾道人' },
  redpacket: { name: '紅包卡',   kind: 'red',  price: 0,    desc: '收到一筆紅包（年份越後面越多）' },
  acquire:   { name: '收購卡', kind: 'acquire', price: 2000, desc: '擲骰前，以原價 2 倍收購目前車站的一項對手物件，款項交給原持有人' },
  tax:       { name: '查稅卡',   kind: 'tax',  price: 0,    desc: '向現金最多的對手收取其現金 10%' },
  remote:    { name: '遙控骰子', kind: 'remote', price: 3000, desc: '不擲骰，自己指定這回合前進 1～6 步；身上已有一張時不能再買' },
};
const SHOP_CARDS = ['express', 'limited', 'hsr', 'warp', 'stop', 'charm', 'acquire', 'remote'];
const DRAW_WEIGHTS = { express: 28, limited: 14, hsr: 4, warp: 10, near: 4, stop: 10, charm: 8, redpacket: 14, tax: 8, acquire: 6, remote: 6 };
const REMOTE_MAX_STEPS = 6;
/* 商店購買限制：遙控骰子身上已有一張就不能再買（從卡片格抽到則不受限） */
const shopBlocked = (key, cards) => key === 'remote' && cards.includes('remote');

/* 遊戲機場：在對應車站辦理搭機，不代表現實航班。票價單位為萬元。 */
const AIRPORTS = ['taipei', 'taoyuan', 'taichung', 'kaohsiung', 'hualien', 'taitung'];
const FLIGHT_BASE_FARE = 1500;
const FLIGHT_FARE_PER_TILE = 80;

/* 遊戲港口間提供直達航線，非現實客輪班表。票價單位為萬元。 */
const PORTS = ['keelung', 'suao', 'hualien', 'taichung', 'kaohsiung'];
const BOAT_BASE_FARE = 800;
const BOAT_FARE_PER_TILE = 40;

/* 離島採分區示意圖，每島僅一站；交通資料來源見 docs/island-transport.md。 */
const ISLANDS = [
  { id: 'penghu', name: '澎湖', x: 100, y: 780, spot: '西嶼', goods: ['仙人掌冰', '海景民宿'], specialty: '玄武岩導覽' },
  { id: 'kinmen', name: '金門', x: 100, y: 470, spot: '金城', goods: ['貢糖老店', '高粱酒坊'], specialty: '閩式古厝民宿' },
  { id: 'matsu', name: '馬祖', x: 100, y: 180, spot: '南竿', goods: ['繼光餅', '老酒工坊'], specialty: '藍眼淚導覽' },
  { id: 'greenisland', name: '綠島', x: 1020, y: 1160, spot: '朝日溫泉', goods: ['海草冰', '潛水中心'], specialty: '海底溫泉' },
  { id: 'lanyu', name: '蘭嶼', x: 1020, y: 1430, spot: '紅頭', goods: ['飛魚料理', '島嶼民宿'], specialty: '部落文化導覽' },
  { id: 'liuqiu', name: '小琉球', x: 100, y: 1330, spot: '花瓶岩', goods: ['麻花捲', '浮潛中心'], specialty: '潮間帶導覽' },
];
const ISLAND_STAY_INCOME = 500;
for (const island of ISLANDS) {
  STATIONS.push({ id: island.id, name: island.name, island: island.id, lab: 't', mapX: island.x, mapY: island.y,
    props: [[island.goods[0], 1500, 40, 'food'], [island.goods[1], 6000, 18, 'tour'], [island.specialty, 4000, 20, 'tour']] });
}
// [出發站, 抵達站, 計費距離, 實際交通端點]；雙向，票價仍採遊戲經濟。
const ISLAND_AIRPORT_NAMES = { taipei:'台北松山', taichung:'台中清泉崗', chiayi:'嘉義', tainan:'台南', kaohsiung:'高雄小港' };
const ISLAND_FLIGHTS = [
  ...['taipei','taichung','chiayi','tainan','kaohsiung'].map(s => [s,'penghu',22,`${ISLAND_AIRPORT_NAMES[s]}機場 ↔ 澎湖機場`]),
  ...['taipei','taichung','chiayi','tainan','kaohsiung'].map(s => [s,'kinmen',28,`${ISLAND_AIRPORT_NAMES[s]}機場 ↔ 金門尚義機場`]),
  ...['taipei','taichung','kaohsiung'].map(s => [s,'matsu',26,`${ISLAND_AIRPORT_NAMES[s]}機場 ↔ 馬祖南竿機場`]),
  ['taitung','greenisland',8,'台東豐年機場 ↔ 綠島機場'],
  ['taitung','lanyu',12,'台東豐年機場 ↔ 蘭嶼機場'],
];
const ISLAND_BOATS = [
  ['chiayi','penghu',22,'嘉義轉乘布袋港 ↔ 澎湖馬公港'],
  ['kaohsiung','penghu',30,'高雄港 ↔ 澎湖馬公港'],
  ['keelung','matsu',36,'基隆港 ↔ 馬祖南竿福澳港'],
  ['taitung','greenisland',8,'台東轉乘富岡漁港 ↔ 綠島南寮漁港'],
  ['taitung','lanyu',12,'台東轉乘富岡漁港 ↔ 蘭嶼開元港'],
  ['kenting','lanyu',12,'墾丁轉乘後壁湖 ↔ 蘭嶼開元港'],
  ['pingtung','liuqiu',5,'屏東轉乘東港碼頭 ↔ 小琉球白沙港'],
];
// 保留原有本島遊戲航線；離島不參與任意兩站互通。
const MAINLAND_AIRPORTS = [...AIRPORTS], MAINLAND_PORTS = [...PORTS];
for (const [a,b] of ISLAND_FLIGHTS) for (const sid of [a,b]) if (!AIRPORTS.includes(sid)) AIRPORTS.push(sid);
for (const [a,b] of ISLAND_BOATS) for (const sid of [a,b]) if (!PORTS.includes(sid)) PORTS.push(sid);
