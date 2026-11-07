// Miniature SchoolGiant screens drawn in HTML for the sign-in showcase — what the laptop and phone show
// until real screenshots are put in public/login/. Shapes, not data: a glance at each module's main
// screen (the numbers are illustrative). Sizes are in % of the device screen and text in cqi of it
// (the screen is the size container, LoginShowcase's Screens), so the whole picture scales together.

const BED = { o: 'bg-brand-500', a: 'bg-emerald-400', c: 'bg-amber-400', b: 'bg-slate-300' }
const BEDS = 'ooaoocoaoobooaocooaoooaobooacooo'.split('')
const PILL = { w: 'bg-amber-100 text-amber-700', c: 'bg-brand-100 text-brand-700', d: 'bg-emerald-100 text-emerald-700' }

function Sidebar() {
  return (
    <div className="w-[15%] h-full bg-navy-900 flex flex-col gap-[6%] p-[2%] pt-[3%]">
      <div className="flex items-center gap-[8%]">
        <span className="w-[22%] aspect-square rounded-[3px] bg-brand-500" />
        <span className="h-[3px] flex-1 rounded bg-white/70" />
      </div>
      {[90, 70, 80, 60, 75, 65, 85, 55].map((w, i) => (
        <div key={i} className={`flex items-center gap-[8%] rounded-[2px] px-[6%] py-[3%] ${i === 0 ? 'bg-white/15' : ''}`}>
          <span className="w-[10%] aspect-square rounded-[1px] bg-white/40" />
          <span className="h-[2px] rounded bg-white/40" style={{ width: `${w * 0.6}%` }} />
        </div>
      ))}
    </div>
  )
}

function Topbar({ title }) {
  return (
    <div className="h-[8%] flex items-center justify-between px-[3%] border-b border-slate-200 bg-white">
      <span className="text-[0.55em] font-semibold text-slate-800">{title}</span>
      <span className="flex items-center gap-[6px]">
        <span className="w-[60px] h-[45%] rounded bg-slate-100" />
        <span className="h-[55%] aspect-square rounded-full bg-brand-200" />
      </span>
    </div>
  )
}

function Tile({ label, value, tone = 'bg-brand-50' }) {
  return (
    <div className="rounded-[4px] bg-white ring-1 ring-slate-200 p-[6%] flex flex-col gap-[6%]">
      <span className={`w-[16%] aspect-square rounded-[3px] ${tone}`} />
      <span className="text-[0.4em] text-slate-500 leading-none">{label}</span>
      <span className="text-[0.75em] font-bold text-slate-900 leading-none">{value}</span>
    </div>
  )
}

function Area() {
  return (
    <svg viewBox="0 0 200 60" className="w-full h-full" preserveAspectRatio="none" aria-hidden="true">
      {[15, 30, 45].map((y) => <line key={y} x1="0" x2="200" y1={y} y2={y} stroke="#E9EBEF" strokeWidth="0.6" />)}
      <path d="M0 48 L20 40 L40 44 L60 30 L80 34 L100 22 L120 26 L140 16 L160 20 L180 10 L200 14 L200 60 L0 60Z" fill="rgb(var(--brand-500))" fillOpacity="0.12" />
      <path d="M0 48 L20 40 L40 44 L60 30 L80 34 L100 22 L120 26 L140 16 L160 20 L180 10 L200 14" fill="none" stroke="rgb(var(--brand-500))" strokeWidth="1.6" />
      <path d="M0 54 L20 50 L40 52 L60 44 L80 46 L100 38 L120 41 L140 33 L160 36 L180 28 L200 31" fill="none" stroke="#EB6834" strokeWidth="1.4" />
    </svg>
  )
}

function Card({ title, children, className = '' }) {
  return (
    <div className={`rounded-[4px] bg-white ring-1 ring-slate-200 p-[2.5%] flex flex-col min-h-0 ${className}`}>
      <span className="text-[0.45em] font-semibold text-slate-700 mb-[2%]">{title}</span>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}

function Rows({ n = 5, pills = 'wcdwc' }) {
  return (
    <div className="flex flex-col gap-[7%] h-full">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-[4%]">
          <span className="h-[9px] aspect-square rounded-full bg-slate-200" />
          <span className="flex-1 flex flex-col gap-[2px]">
            <span className="h-[2.5px] rounded bg-slate-300" style={{ width: `${70 - i * 7}%` }} />
            <span className="h-[2px] rounded bg-slate-200" style={{ width: `${45 - i * 4}%` }} />
          </span>
          <span className={`text-[0.32em] px-[4%] py-[1px] rounded-full ${PILL[pills[i % pills.length]]}`}>{{ w: 'Waiting', c: 'In consult', d: 'Done' }[pills[i % pills.length]]}</span>
        </div>
      ))}
    </div>
  )
}

const LAPTOP = {
  home: () => (
    <>
      <div className="grid grid-cols-4 gap-[1.5%]">
        <Tile label="OPD today" value="142" />
        <Tile label="In the wards" value="86" tone="bg-emerald-50" />
        <Tile label="Collected" value="₹4.8L" tone="bg-amber-50" />
        <Tile label="Lab pending" value="23" tone="bg-rose-50" />
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-[1.5%]">
        <Card title="Billed and collected" className="col-span-2"><Area /></Card>
        <Card title="Today's queue"><Rows n={5} /></Card>
      </div>
    </>
  ),
  opd: () => (
    <div className="flex-1 min-h-0 grid grid-cols-3 gap-[1.5%]">
      <Card title="Waiting for the doctor" className="col-span-2"><Rows n={7} pills="wwcwdwc" /></Card>
      <div className="flex flex-col gap-[3%]">
        <Tile label="Seen today" value="64" />
        <Tile label="Average wait" value="18 min" tone="bg-amber-50" />
        <Card title="Vitals" className="flex-1"><Area /></Card>
      </div>
    </div>
  ),
  beds: () => (
    <div className="flex-1 min-h-0 flex flex-col gap-[2%]">
      {['General ward', 'ICU', 'Private rooms'].map((w, k) => (
        <Card key={w} title={w}>
          <div className="grid grid-cols-12 gap-[1.5%]">
            {BEDS.slice(k * 4, k * 4 + (k === 1 ? 8 : 12)).map((s, i) => <span key={i} className={`aspect-[4/3] rounded-[2px] ${BED[s]}`} />)}
          </div>
        </Card>
      ))}
    </div>
  ),
  billing: () => (
    <div className="flex-1 min-h-0 grid grid-cols-3 gap-[1.5%]">
      <Card title="All bills" className="col-span-2">
        <div className="flex flex-col gap-[6%]">
          {[['B-1042', '₹2,450', 'd'], ['B-1041', '₹18,900', 'w'], ['B-1040', '₹640', 'd'], ['B-1039', '₹5,120', 'd'], ['B-1038', '₹1,280', 'w'], ['B-1037', '₹9,760', 'd']].map(([no, amt, s]) => (
            <div key={no} className="flex items-center gap-[4%] text-[0.38em] text-slate-600">
              <span className="font-mono w-[18%]">{no}</span>
              <span className="flex-1 h-[2.5px] rounded bg-slate-200" />
              <span className="font-mono text-slate-800">{amt}</span>
              <span className={`px-[3%] rounded-full ${s === 'd' ? PILL.d : PILL.w}`}>{s === 'd' ? 'Paid' : 'Due'}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title="How patients paid">
        <svg viewBox="0 0 42 42" className="w-[70%] mx-auto" aria-hidden="true">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#E9EBEF" strokeWidth="6" />
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(var(--brand-500))" strokeWidth="6" strokeDasharray="55 45" strokeDashoffset="25" />
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#1BAF7A" strokeWidth="6" strokeDasharray="28 72" strokeDashoffset="70" />
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="#EDA100" strokeWidth="6" strokeDasharray="15 85" strokeDashoffset="42" />
        </svg>
      </Card>
    </div>
  ),
}

/** The laptop's screen: sidebar, top bar and the module's main view. */
export function LaptopMock({ kind, title }) {
  const Body = LAPTOP[kind] ?? LAPTOP.home
  return (
    <div className="absolute inset-0 flex bg-bg" style={{ fontSize: 'clamp(9px, 2.2cqi, 14px)' }}>
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar title={title} />
        <div className="flex-1 min-h-0 flex flex-col gap-[2.5%] p-[2.5%]">
          <Body />
        </div>
      </div>
    </div>
  )
}

/** The phone's screen: the same module, one column. */
export function PhoneMock({ kind, title }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-bg" style={{ fontSize: 'clamp(5px, 7cqi, 10px)' }}>
      <div className="h-[7%] flex items-center px-[6%] bg-white border-b border-slate-200">
        <span className="text-[0.8em] font-semibold text-slate-800 truncate">{title}</span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-[3%] p-[5%]">
        {kind === 'beds' ? (
          <div className="grid grid-cols-4 gap-[4%]">{BEDS.slice(0, 20).map((s, i) => <span key={i} className={`aspect-[4/3] rounded-[2px] ${BED[s]}`} />)}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-[4%]">
              <Tile label={kind === 'billing' ? 'Collected' : 'Today'} value={kind === 'billing' ? '₹4.8L' : '142'} />
              <Tile label={kind === 'opd' ? 'Waiting' : 'Pending'} value="23" tone="bg-amber-50" />
            </div>
            {kind === 'home' && <div className="h-[22%] rounded-[4px] bg-white ring-1 ring-slate-200 p-[3%]"><Area /></div>}
            <div className="flex-1 min-h-0 rounded-[4px] bg-white ring-1 ring-slate-200 p-[4%]"><Rows n={kind === 'home' ? 5 : 8} /></div>
          </>
        )}
      </div>
    </div>
  )
}
