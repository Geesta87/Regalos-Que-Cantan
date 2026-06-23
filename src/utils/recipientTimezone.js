// recipientTimezone.js
//
// The gift-text scheduler interprets the buyer-picked time as the RECIPIENT's
// local time ("send it at 5 PM her time"). We infer the recipient's timezone
// from their phone's area code (US/CA/PR), convert the picked wall-clock time to
// a UTC instant in THAT zone (DST-correct via Intl), and show the resolved zone
// on the form. Unknown area codes fall back to the buyer's own timezone.

const TZ = {
  ET: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  AZ: 'America/Phoenix',     // no DST
  PT: 'America/Los_Angeles',
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',    // no DST
  PR: 'America/Puerto_Rico', // AST, no DST
};

// Area codes grouped by their dominant timezone. Split codes (e.g. El Paso) are
// placed in the zone that covers the larger population; the on-form label lets a
// buyer notice if it's off for a ported number.
const GROUPS = {
  ET: ['203','475','860','959','302','202','771','239','305','321','352','386','407','448','561','656','689','727','754','772','786','813','850','904','941','954','229','404','470','478','678','706','762','770','912','260','317','463','574','765','812','930','502','606','859','207','240','301','410','443','667','339','351','413','508','617','774','781','857','978','231','248','269','313','517','586','616','734','810','906','947','989','603','201','551','609','640','732','848','856','862','908','973','212','315','332','347','516','518','585','607','631','646','680','716','718','838','845','914','917','929','934','252','336','704','743','828','910','919','980','984','216','234','283','326','330','380','419','440','513','567','614','740','937','215','223','267','272','412','445','484','570','582','610','717','724','814','835','878','401','803','821','839','843','854','864','423','865','802','276','434','540','571','703','757','804','826','304','681'],
  CT: ['205','251','256','334','659','938','327','479','501','870','217','224','309','312','331','447','464','618','630','708','773','779','815','847','872','219','319','515','563','641','712','316','620','785','913','270','364','225','318','337','504','985','218','320','507','612','651','763','952','228','601','662','769','314','417','557','573','636','660','816','975','308','402','531','701','405','539','572','580','918','605','615','629','731','901','210','214','254','281','325','346','361','409','430','432','469','512','682','713','726','737','806','817','830','832','903','936','940','945','956','972','979','262','274','414','534','608','715','920'],
  MT: ['303','719','720','970','983','208','986','406','505','575','957','385','435','801','307','915'],
  AZ: ['480','520','602','623','928'],
  PT: ['209','213','279','310','323','341','408','415','424','442','510','530','559','562','619','626','628','650','657','661','669','707','714','747','760','805','818','820','831','858','909','916','925','935','949','951','702','725','775','458','503','541','971','206','253','360','425','509','564'],
  AK: ['907'],
  HI: ['808'],
  PR: ['787','939','340'],
};

const AREA_CODE_TZ = {};
for (const [key, codes] of Object.entries(GROUPS)) {
  for (const c of codes) AREA_CODE_TZ[c] = TZ[key];
}

// Pull the 3-digit area code out of a US/CA/PR phone number.
function areaCodeOf(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1, 4);
  if (d.length === 10) return d.slice(0, 3);
  return null;
}

// Returns an IANA timezone for the recipient's number, or null if unknown.
export function guessTimezoneFromPhone(phone) {
  const ac = areaCodeOf(phone);
  return ac ? (AREA_CODE_TZ[ac] || null) : null;
}

// Offset (ms) of `timeZone` from UTC at the given instant — DST-aware.
function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = p.hour === '24' ? '00' : p.hour;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Convert a wall-clock time (dateStr 'YYYY-MM-DD', timeStr 'HH:MM') interpreted
// IN `timeZone` to a real UTC Date. One offset iteration is DST-correct except in
// the rare hour straddling a DST jump, which is acceptable for a gift.
export function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const [h, mi] = String(timeStr).split(':').map(Number);
  const utcGuess = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0);
  const offset = tzOffsetMs(timeZone, new Date(utcGuess));
  return new Date(utcGuess - offset);
}

// Short Spanish label for the common US zones.
export function tzLabel(timeZone) {
  return ({
    'America/New_York': 'hora del Este',
    'America/Chicago': 'hora del Centro',
    'America/Denver': 'hora de la Montaña',
    'America/Phoenix': 'hora de Arizona',
    'America/Los_Angeles': 'hora del Pacífico',
    'America/Anchorage': 'hora de Alaska',
    'Pacific/Honolulu': 'hora de Hawái',
    'America/Puerto_Rico': 'hora de Puerto Rico',
  })[timeZone] || 'su hora local';
}

// Selectable zones for the "recipient's timezone" override dropdown. Pre-filled
// from the area code; the buyer only changes it if their loved one moved and
// kept an out-of-area number.
export const TZ_OPTIONS = [
  { value: 'America/New_York', label: 'Este — Nueva York, Florida, Georgia' },
  { value: 'America/Chicago', label: 'Centro — Texas, Illinois, Tennessee' },
  { value: 'America/Denver', label: 'Montaña — Colorado, Nuevo México' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacífico — California, Washington' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawái' },
  { value: 'America/Puerto_Rico', label: 'Puerto Rico' },
];

// Returns TZ_OPTIONS guaranteed to include `tz` (prepends it if it's some other
// IANA zone, e.g. the buyer's own), so a <select> always has a matching option.
export function tzOptionsWith(tz) {
  if (!tz || TZ_OPTIONS.some((o) => o.value === tz)) return TZ_OPTIONS;
  return [{ value: tz, label: tzLabel(tz) }, ...TZ_OPTIONS];
}

// '17:00' -> '5:00 PM'
export function format12(timeStr) {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ap}`;
}
