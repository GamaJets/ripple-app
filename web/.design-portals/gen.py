# Generates the fifteen portal mockups as .dc.html artboards.
#
# One shared shell so the three portals read as one product, and the exact
# tokens from studio-web/app/globals.css so the mockups and the real console
# cannot disagree about what "surface2" or "brand" means.
import pathlib

T = dict(
    bg="#0c1413", surface="#10201d", surface2="#14261f", surface3="#1b3229",
    ink="#e8f2f0", ink2="#b6c9c4", ink3="#6f8b87", ring="rgba(255,255,255,0.09)",
    brand="#16b8a6", brand_ink="#04211d",
    good="#0ca30c", warn="#fab219", serious="#ec835a", crit="#d03b3b",
    coach="#7a70f0", studio="#e0912f",
)
SANS = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
MONO = 'ui-monospace, "SF Mono", Menlo, monospace'

def micro(s, color=None):
    return (f'<div style="font-family:{MONO};font-size:11px;letter-spacing:0.09em;'
            f'text-transform:uppercase;color:{color or T["ink2"]}">{s}</div>')

def kpi(label, value, note, tone=None, dash=False):
    col = T["ink3"] if dash else (tone or T["ink"])
    return f'''<div style="background:{T['surface']};padding:14px 16px">
      {micro(label)}
      <div style="font-family:{MONO};font-variant-numeric:tabular-nums;font-size:26px;margin-top:6px;letter-spacing:-0.02em;color:{col}">{value}</div>
      <div style="font-size:11.5px;color:{T['ink3']};margin-top:3px">{note}</div>
    </div>'''

def kpis(items, cols=4):
    return (f'<div style="display:grid;grid-template-columns:repeat({cols},minmax(0,1fr));'
            f'gap:1px;background:{T["ring"]};border:1px solid {T["ring"]};border-radius:10px;overflow:hidden">'
            + "".join(items) + '</div>')

def panel(title, body, note=None, accent=None):
    head = f'''<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid {T['ring']}">
        <div style="font-size:13px;font-weight:600;color:{T['ink']}">{title}</div>
        {f'<div style="font-family:{MONO};font-size:11px;color:{T["ink2"]}">{note}</div>' if note else ''}
      </div>'''
    bar = f'<div style="height:2px;background:{accent}"></div>' if accent else ''
    return f'''<div style="background:{T['surface']};border:1px solid {T['ring']};border-radius:10px;overflow:hidden">{bar}{head}
      <div style="padding:14px 16px">{body}</div></div>'''

def table(headers, rows, aligns=None):
    aligns = aligns or ['left'] * len(headers)
    th = "".join(
        f'<th style="text-align:{a};font-family:{MONO};font-size:11px;letter-spacing:0.08em;'
        f'text-transform:uppercase;color:{T["ink2"]};font-weight:400;padding:0 10px 8px 0">{h}</th>'
        for h, a in zip(headers, aligns))
    trs = []
    for r in rows:
        tds = "".join(
            f'<td style="text-align:{a};padding:9px 10px 9px 0;border-top:1px solid {T["ring"]};'
            f'font-size:13px;color:{T["ink2"]}{";font-family:"+MONO+";font-variant-numeric:tabular-nums" if a=="right" else ""}">{c}</td>'
            for c, a in zip(r, aligns))
        trs.append(f'<tr>{tds}</tr>')
    return (f'<table style="width:100%;border-collapse:collapse"><thead><tr>{th}</tr></thead>'
            f'<tbody>{"".join(trs)}</tbody></table>')

# Pills carry the most urgent words in the product, so they were the worst
# place for 11px text at 3.5:1. Bumped to 12px, and the two dark tones are
# lightened for small text — the tokens stay as they are for large figures.
SMALL_SAFE = {T['crit']: '#ff7a7a', T['serious']: '#ffa780', T['good']: '#3ecf62'}
def pill(text, tone):
    c = SMALL_SAFE.get(tone, tone)
    return (f'<span style="font-size:12px;padding:3px 9px;border-radius:20px;'
            f'border:1px solid {c}66;color:{c};white-space:nowrap">{text}</span>')

def bar_row(label, pct, right, tone=None):
    # pct is the bar's width. Callers pass a value derived from the figure on
    # the right — a 7.5 kg drop drawn two units shorter is a lie in a shape.
    return f'''<div style="display:grid;grid-template-columns:130px 1fr 62px;gap:12px;align-items:center;padding:7px 0">
      <div style="font-size:12.5px;color:{T['ink2']};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{label}</div>
      <div style="height:7px;border-radius:4px;background:{T['surface3']};overflow:hidden">
        <div style="height:100%;width:{pct}%;background:{tone or T['brand']}"></div></div>
      <div style="font-family:{MONO};font-variant-numeric:tabular-nums;font-size:12px;color:{T['ink2']};text-align:right">{right}</div>
    </div>'''

def shell(app, accent, nav, active, title, subtitle, body, illustrative=True, who=None):
    items = "".join(
        f'''<div style="padding:7px 11px;border-radius:7px;font-size:13px;
            {'background:'+T['surface3']+';color:'+T['ink'] if n==active else 'color:'+T['ink3']}">{n}</div>'''
        for n in nav)
    tag = (f'<span style="font-family:{MONO};font-size:11px;color:{T["ink2"]};border:1px solid {T["ring"]};'
           f'border-radius:20px;padding:2px 8px">Illustrative</span>') if illustrative else ''
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body {{ margin:0; background:{T['bg']}; }}
    a {{ color:{T['brand']}; text-decoration:none; }}
    a:hover {{ color:#3fd3c2; text-decoration:underline; }}
  </style>
</helmet>
<div style="display:grid;grid-template-columns:212px 1fr;height:900px;background:{T['bg']};color:{T['ink']};font-family:{SANS};font-size:14px;line-height:1.5">

  <div style="border-right:1px solid {T['ring']};background:{T['surface']};padding:18px 14px;display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;align-items:center;gap:9px">
      <div style="width:26px;height:26px;border-radius:8px;background:{accent};display:grid;place-items:center">
        <div style="width:9px;height:9px;border-radius:5px;background:#fff"></div></div>
      <div style="font-size:13.5px;font-weight:650;letter-spacing:-0.01em">{app}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:2px">{items}</div>
    <div style="margin-top:auto;font-family:{MONO};font-size:11px;color:{T['ink2']};line-height:1.6">
      {who or 'Signed in as owner<br>Kinetic Gym · Dubai'}
    </div>
  </div>

  <div style="padding:22px 24px;overflow:hidden">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px">
      <div>
        <h1 style="margin:0;font-size:24px;font-weight:650;letter-spacing:-0.015em;line-height:1.2">{title}</h1>
        <div style="font-size:13px;color:{T['ink3']};margin-top:4px">{subtitle}</div>
      </div>
      {tag}
    </div>
    {body}
  </div>
</div>
</x-dc>
</body>
</html>'''

S_NAV = ['Overview', 'Members', 'Classes', 'Timetable', 'Sessions', 'Money', 'Payroll', 'Door', 'Equipment', 'Staff', 'Retention']
C_NAV = ['Today', 'Roster', 'Programs', 'Schedule', 'Library', 'Messages', 'Earnings']
M_NAV = ['Today', 'Training', 'Nutrition', 'Progress', 'Bookings', 'Coach']
A, B, K = T['brand'], T['coach'], T['studio']

pages = {}

# ─────────────────────────── STUDIO ───────────────────────────
pages['Main'] = shell('Repple Studio', K, S_NAV, 'Overview',
  'This morning', 'Tuesday 27 August · everything the gym has produced so far today', f'''
  {kpis([
    kpi('In the building','37','of 243 active members'),
    kpi('Through the door','435','since 06:00'),
    kpi('Class fill · today','75%','68 of 91 places', T['warn']),
    kpi('Taken today','4,180','AED · 22 payments'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:16px">
    {panel('Needs a decision', f"""
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div><div style="font-size:13px;color:{T['ink']}">12 sessions have no outcome</div>
          <div style="font-size:11.5px;color:{T['ink3']}">Payroll cannot be priced until every one is marked</div></div>
          {pill('Mark them', T['warn'])}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid {T['ring']};padding-top:10px">
          <div><div style="font-size:13px;color:{T['ink']}">14 clients left behind by two departures</div>
          <div style="font-size:11.5px;color:{T['ink3']}">Still members, still coming in, none rebooked in 21 days</div></div>
          {pill('Reassign', T['serious'])}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid {T['ring']};padding-top:10px">
          <div><div style="font-size:13px;color:{T['ink']}">Leg press out of service · 11 days</div>
          <div style="font-size:11.5px;color:{T['ink3']}">Two programs rewritten around it · no engineer booked</div></div>
          {pill('Book', T['crit'])}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid {T['ring']};padding-top:10px">
          <div><div style="font-size:13px;color:{T['ink']}">6 memberships lapse this week</div>
          <div style="font-size:11.5px;color:{T['ink3']}">4,140 AED of recurring revenue</div></div>
          {pill('Contact', T['warn'])}</div>
      </div>""", 'four things', K)}
    {panel('Why class fill moved', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
        Down from 89% to 82% over thirty days. Two trainers left last month; their fourteen clients
        still hold memberships and still come through the door, and none of them has rebooked a class since.
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid {T['ring']}">
        {micro('Where the answer came from')}
        <div style="font-size:12px;color:{T['ink3']};margin-top:6px;line-height:1.6">
          Timetable, door, memberships and staff — read together.
        </div>
      </div>""", None, K)}
  </div>
  <div style="height:16px"></div>
  {panel('Today, hour by hour', "".join([
      bar_row('06:00 Open gym','34','82', T['brand']),
      bar_row('07:00 HIIT 45','90','18/20', T['brand']),
      bar_row('09:30 Reformer','58','7/12', T['warn']),
      bar_row('12:15 Express','75','18/24', T['brand']),
      bar_row('17:30 Strength','100','20/20 · 4 waiting', T['good']),
      bar_row('19:00 Yoga','33','5/15 · lowest today', T['serious']),
  ]), 'six classes', K)}''')

pages['StudioClasses'] = shell('Repple Studio', K, S_NAV, 'Classes',
  'Classes', 'Fill, attendance and what each class is actually worth', f'''
  {kpis([
    kpi('Fill · 30 days','82%','1,588 of 1,932 places'),
    kpi('Show rate','85%','1,351 attended of 1,588'),
    kpi('Empty places · 30 days','344','across 104 classes', T['warn']),
    kpi('Revenue per class','—','set a class price first', dash=True),
  ])}
  <div style="height:16px"></div>
  {panel('By class', table(
    ['Class','Instructor','Runs','Booked','Attended','Show','Fill'],
    [['Strength 45','Marcus Vaughn','24','480','431','90%','100%'],
     ['HIIT 45','Priya Raman','24','438','372','85%','91%'],
     ['Express 30','Dane Whitfield','20','360','309','86%','75%'],
     ['Reformer','Nadia Cole','16','112','98','88%','58%'],
     ['Yoga Flow','Sam Ellery','20','198','141','71%','66%'],
     ['Open gym','—','168','—','2,904','—','—']],
    ['left','left','right','right','right','right','right']), '5 classes + open gym', K)}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    {panel('Where the empty places are', "".join([
        bar_row('Express · 12:15','100','120 empty', T['crit']),
        bar_row('Yoga Flow · 19:00','85','102 empty', T['serious']),
        bar_row('Reformer · 09:30','67','80 empty', T['warn']),
        bar_row('HIIT · 07:00','35','42 empty', T['brand']),
        bar_row('Strength · 17:30','0','0 empty', T['good']),
    ]), None, K)}
    {panel('Why revenue per class is blank', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
        Revenue per class shows a dash because no class price is set. Studio will not divide
        membership revenue across classes to manufacture a figure — that number would look like
        earnings and would not be.
      </div>
      <div style="margin-top:12px">{pill('Set class pricing', T['brand'])}</div>""", None, K)}
  </div>''')

pages['StudioPayroll'] = shell('Repple Studio', K, S_NAV, 'Payroll',
  'Payroll · August', 'Priced from sessions with a recorded outcome, and nothing else', f'''
  {kpis([
    kpi('Delivered','386','sessions with an outcome'),
    kpi('Unmarked','12','blocking the run', T['warn']),
    kpi('Payable','—','12 sessions still unmarked', dash=True),
    kpi('Session fee','55','AED · set in Ops'),
  ])}
  <div style="height:16px"></div>
  {panel('Why this cannot be run yet', f"""
    <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
      Twelve sessions have passed their start time with no outcome recorded. Pricing them would mean
      paying for no-shows and slots nobody cancelled. Studio holds the total at a dash until each one
      is marked delivered, cancelled or no-show — by the trainer or by you.
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">{pill('Mark 12 outcomes', T['warn'])}{pill('Notify trainers', T['ink3'])}</div>""",
    None, T['warn'])}
  <div style="height:16px"></div>
  {panel('By trainer', table(
    ['Trainer','Clients','Delivered','Unmarked','Cancelled','At 55 AED'],
    [['Marcus Vaughn','31','118','3','6','—'],
     ['Priya Raman','24','96','2','3','—'],
     ['Dane Whitfield','9','52','7','9','—'],
     ['Nadia Cole','18','74','0','2','4,070'],
     ['Sam Ellery','12','46','0','1','2,530'],
     ['Total','94','386','12','21','—']],
    ['left','right','right','right','right','right']), '5 trainers', K)}''')

pages['StudioMember'] = shell('Repple Studio', K, S_NAV, 'Members',
  'Amira Haddad', 'Member since April · Unlimited · every system, one row each', f'''
  {kpis([
    kpi('Visits · 30 days','14','last in Tuesday 07:12'),
    kpi('Classes booked','9','8 attended · 89%'),
    kpi('PT sessions','4','with Marcus Vaughn'),
    kpi('Paying','690','AED / month · card ending 4417'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:16px">
    {panel('Every system, one row each', table(
      ['System','What it holds','Last'],
      [['Door','14 visits this month, average dwell 68 min','Today 07:12'],
       ['Timetable','9 classes booked, 8 attended','Yesterday 18:00'],
       ['Coaching','4 PT sessions with Marcus, all marked delivered','Monday'],
       ['Membership','Unlimited, renews 1 Sept, no failed payments','1 Aug'],
       ['Training','Logged 11 of her own sessions in the app','Today'],
       ['Body','Last InBody 4 weeks ago · −2.1 kg, +0.8 kg muscle','30 Jul']],
      ['left','left','right']), 'six', K)}
    {panel('Retention signal', f"""
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        {pill('Healthy', T['good'])}
        <div style="font-size:12.5px;color:{T['ink3']}">no intervention needed</div>
      </div>
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
        Fourteen visits this month against nine last. Nine classes booked against six. No failed payment.
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid {T['ring']}">
        {micro('Where this comes from')}
        <div style="font-size:12px;color:{T['ink2']};margin-top:6px;line-height:1.6">
          The figures above are rows somebody wrote — a scan, a tap at the door, a payment. The
          word Healthy is not: it is this console reading them, and you can disagree with it.
        </div>
      </div>""", None, T['good'])}
  </div>''')

pages['StudioEquipment'] = shell('Repple Studio', K, S_NAV, 'Equipment',
  'Equipment', 'What is on the floor, what is broken, and what it is costing', f'''
  {kpis([
    kpi('On the floor','128','items tracked'),
    kpi('Out of service','3','longest 11 days', T['crit']),
    kpi('Service due · 30 days','14','none booked yet', T['warn']),
    kpi('Under warranty','62','of 128'),
  ])}
  <div style="height:16px"></div>
  {panel('Out of service', table(
    ['Item','Location','Reported','Down','Effect'],
    [['Rower 3','Cardio floor','23 Aug','4 days','Conditioning circuits lose a station'],
     ['Leg press','Strength','16 Aug','11 days','2 programs re-written around it'],
     ['Treadmill 7','Cardio floor','26 Aug','1 day','—']],
    ['left','left','left','right','left']), '3 items', T['crit'])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    {panel('Service due', table(
      ['Item','Last service','Due','Interval'],
      [['Treadmills 1-8','12 Feb','12 Aug · overdue','6 months'],
       ['Rowers 1-4','2 Mar','2 Sep','6 months'],
       ['Cable stack','—','—','never serviced']],
      ['left','left','left','left']), None, T['warn'])}
    {panel('What it is costing', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
        The leg press has been down eleven days. Two coaches have rewritten programs around it, and
        nobody has booked an engineer. That is a programming problem and a scheduling problem before
        it is a maintenance one, which is why it sits on the same board as the timetable.
      </div>""", None, K)}
  </div>''')

# ─────────────────────────── COACH ───────────────────────────
COACH_WHO = 'Marcus Vaughn · coach<br>Kinetic Gym · Dubai'
MEMBER_WHO = 'Amira Haddad · member<br>Kinetic Gym · Dubai'

pages['CoachToday'] = shell('Repple Coach', B, C_NAV, 'Today',
  'Today', 'Tuesday 27 August · six sessions, two clients drifting', f'''
  {kpis([
    kpi('Sessions today','6','first 07:00, last 19:00'),
    kpi('Unmarked · this week','3','mark them to get paid', T['warn']),
    kpi('Clients','31','4 have not trained in 10 days', T['serious']),
    kpi('Earned · August','6,490','AED · 118 delivered'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px">
    {panel('Your day', table(
      ['Time','Client','Focus','Status'],
      [['07:00','Tom Beckett','Upper push', pill('Delivered', T['good'])],
       ['08:00','Yusuf Rahman','Assessment', pill('Delivered', T['good'])],
       ['10:30','Amira Haddad','Lower · squat build', pill('Now', T['brand'])],
       ['12:00','Lena Sørensen','Conditioning', pill('Booked', T['ink3'])],
       ['17:30','Class · Strength 45','20 booked', pill('Booked', T['ink3'])],
       ['19:00','Priya Nair','Deload week', pill('Booked', T['ink3'])]],
      ['left','left','left','right']), 'six', B)}
    {panel('Log the session you just ran', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6;margin-bottom:12px">
        It lands in the client's own history and counts towards their progress, PRs and calories.
        They can correct it, and both of you see who logged it.
      </div>
      <div style="background:{T['surface2']};border:1px solid {T['ring']};border-radius:8px;padding:12px">
        <div style="font-size:12.5px;color:{T['ink']};margin-bottom:8px">Yusuf Rahman · 08:00</div>
        {table(['Lift','Sets','Top set'],
               [['Back squat','4','82.5 kg'],['Romanian deadlift','3','70 kg'],['Split squat','3','24 kg']],
               ['left','right','right'])}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">{pill('Save to their record', T['brand'])}{pill('Mark delivered', T['ink3'])}</div>""",
      None, B)}
  </div>
  <div style="height:16px"></div>
  {panel('Drifting', table(
    ['Client','Last trained','Last message','Sessions left','Signal'],
    [['Dane Okafor','17 days ago','You, 12 days ago','0', pill('Likely to cancel', T['crit'])],
     ['Marta Silva','12 days ago','Them, 11 days ago','3', pill('Watch', T['serious'])],
     ['Ben Traoré','10 days ago','You, 3 days ago','6', pill('Watch', T['warn'])],
     ['Aisha Karim','10 days ago','Them, yesterday','2', pill('On holiday', T['ink3'])]],
    ['left','left','left','right','right']), 'four', T['serious'])}''', who=COACH_WHO)

pages['CoachRoster'] = shell('Repple Coach', B, C_NAV, 'Roster',
  'Roster', '31 clients · sorted by who needs you first', f'''
  {kpis([
    kpi('Active','31','24 online, 7 in person'),
    kpi('Trained this week','19','of 31'),
    kpi('Adherence · median','78%','check-ins kept'),
    kpi('Packs running low','5','2 or fewer sessions left', T['warn']),
  ])}
  <div style="height:16px"></div>
  {panel('Everyone', table(
    ['Client','Goal','Last trained','Adherence','Weight','Pack','Signal'],
    [['Dane Okafor','Fat loss','17 days','32%','+1.4 kg','0', pill('At risk', T['crit'])],
     ['Marta Silva','Build muscle','12 days','54%','—','3', pill('Watch', T['serious'])],
     ['Ben Traoré','Recomp','10 days','61%','−0.8 kg','6', pill('Watch', T['warn'])],
     ['Amira Haddad','Fat loss','Today','94%','−2.1 kg','8', pill('Healthy', T['good'])],
     ['Tom Beckett','Build muscle','Today','88%','+1.9 kg','12', pill('Healthy', T['good'])],
     ['Lena Sørensen','Tone','2 days','81%','−0.4 kg','2', pill('Low pack', T['warn'])],
     ['Priya Nair','Recomp','3 days','76%','—','5', pill('Healthy', T['good'])]],
    ['left','left','left','right','right','right','right']), 'showing 7 of 31', B)}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    {panel('A dash is not zero', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
        Marta and Priya show a dash for weight because neither has logged one since starting — not
        because they have not changed. A zero there would read as "no progress" and it would be an
        invention.
      </div>""", None, B)}
    {panel('Add a client', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6;margin-bottom:12px">
        Give them your code. It reaches them whatever address they signed up with — an email invite
        only works if you spell it exactly as they did.
      </div>
      <div style="background:{T['surface2']};border:1px solid {T['ring']};border-radius:8px;padding:14px;text-align:center">
        <div style="font-family:{MONO};font-size:28px;letter-spacing:6px;color:{T['ink']}">2JE8NC</div>
        <div style="font-size:11.5px;color:{T['ink3']};margin-top:5px">3 joined with it · 1 waiting on you</div>
      </div>""", None, B)}
  </div>''', who=COACH_WHO)

pages['CoachClient'] = shell('Repple Coach', B, C_NAV, 'Roster',
  'Amira Haddad', 'Fat loss · 18 weeks in · trains four times a week', f'''
  {kpis([
    kpi('Weight','−2.1','kg since starting', T['good']),
    kpi('Adherence','94%','check-ins kept'),
    kpi('Sessions','68','11 logged by you'),
    kpi('Body fat','−1.4','pts · last scan 30 Jul', T['good']),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px">
    {panel('Squat · top set each week', "".join([
        bar_row('Week 12','62','72.5 kg'), bar_row('Week 13','66','75 kg'),
        bar_row('Week 14','66','75 kg'), bar_row('Week 15','72','80 kg'),
        bar_row('Week 16','76','82.5 kg'), bar_row('Week 17','60','65 kg · deload', T['warn']),
        bar_row('Week 18','88','82.5 kg', T['good']),
    ]), 'seven weeks', B)}
    {panel('What changed and when', f"""
      <div style="display:flex;flex-direction:column;gap:11px">
        <div><div style="font-size:12.5px;color:{T['ink']}">Protein target raised to 130 g</div>
          <div style="font-size:11.5px;color:{T['ink3']}">Week 15 · she asked · strength moved the week after</div></div>
        <div style="border-top:1px solid {T['ring']};padding-top:11px">
          <div style="font-size:12.5px;color:{T['ink']}">Deload week 17</div>
          <div style="font-size:11.5px;color:{T['ink3']}">Sleep averaged 5.4 h for nine days</div></div>
        <div style="border-top:1px solid {T['ring']};padding-top:11px">
          <div style="font-size:12.5px;color:{T['ink']}">Moved to four sessions</div>
          <div style="font-size:11.5px;color:{T['ink3']}">Week 11 · from three</div></div>
      </div>""", None, B)}
  </div>
  <div style="height:16px"></div>
  {panel('This week', table(
    ['Day','Session','Logged by','Volume','Felt'],
    [['Mon 26','Upper push','You','5,100 kg','Good'],
     ['Sat 24','Lower · hinge','Her','7,900 kg','Good'],
     ['Fri 23','Conditioning','Her','—','Easy'],
     ['Tue 27','Lower · squat build','—','—','booked 10:30'],
     ['Wed 28','Rest','—','—','—']],
    ['left','left','left','right','right']), 'five days', B)}''', who=COACH_WHO)

pages['CoachProgram'] = shell('Repple Coach', B, C_NAV, 'Programs',
  'Programs', 'Nine templates, 27 clients assigned, 4 without one', f'''
  {kpis([
    kpi('Templates','9','4 in use this week'),
    kpi('Assigned','27','of 31 clients'),
    kpi('Without a program','4','all joined this week', T['warn']),
    kpi('Your exercises','46','typed once, reused'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:16px">
    {panel('Templates', table(
      ['Name','Days','Assigned'],
      [['Strength · 4 day','4','11'],['Fat loss · 3 day','3','8'],
       ['Recomp · 4 day','4','5'],['Return from injury','3','2'],['Deload','4','1']],
      ['left','right','right']), 'five', B)}
    {panel('Strength · 4 day — Monday', f"""
      {table(['Exercise','Sets','Reps','Load','Video'],
        [['Back squat','4','5','RPE 8','Yours'],
         ['Romanian deadlift','3','8','RPE 7','Yours'],
         ['Bulgarian split squat','3','10 e/s','RPE 7','Academy'],
         ['Hanging leg raise','3','12','—','—']],
        ['left','right','right','right','right'])}
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid {T['ring']};font-size:12px;color:{T['ink3']};line-height:1.6">
        Two lifts use clips you filmed; one falls back to the Academy library; one has no video and
        says so rather than showing a stranger doing something different.
      </div>""", '4 exercises', B)}
  </div>''', who=COACH_WHO)

pages['CoachEarnings'] = shell('Repple Coach', B, C_NAV, 'Earnings',
  'Earnings', 'August · what you have delivered and what is still unmarked', f'''
  {kpis([
    kpi('Delivered','118','sessions with an outcome'),
    kpi('Unmarked','3','holding up 165 AED', T['warn']),
    kpi('Earned','6,490','AED at 55 per session'),
    kpi('Pending','—','3 sessions unmarked', dash=True),
  ])}
  <div style="height:16px"></div>
  {panel('Mark these and they are counted', table(
    ['Date','Client','Started','Outcome'],
    [['22 Aug','Dane Okafor','17:30', pill('Mark it', T['warn'])],
     ['24 Aug','Marta Silva','12:00', pill('Mark it', T['warn'])],
     ['26 Aug','Ben Traoré','08:00', pill('Mark it', T['warn'])]],
    ['left','left','left','right']), 'three', T['warn'])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px">
    {panel('Month by month', "".join([
        bar_row('April','58','78 sessions'), bar_row('May','66','89'),
        bar_row('June','74','99'), bar_row('July','85','114'),
        bar_row('August','88','118 so far', T['good']),
    ]), None, B)}
    {panel('How this is counted', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
        A session counts when somebody records what happened to it — delivered, cancelled or no-show.
        Not when it was booked, and not when its start time passed. Your gym pays on delivered
        sessions, so an unmarked one sits here until somebody says what happened.
      </div>""", None, B)}
  </div>''', who=COACH_WHO)

# ─────────────────────────── CLIENT ───────────────────────────
pages['ClientToday'] = shell('Repple', A, M_NAV, 'Today',
  'Good morning, Amira', 'Tuesday 27 August · week 18', f'''
  {kpis([
    kpi('Readiness','82','from sleep and load', T['good']),
    kpi('Slept','7.4','h · seven nights, logged by you'),
    kpi('Trained','1','session since Monday'),
    kpi('Fuel left','1,240','kcal of 2,180'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:16px">
    {panel('Today', f"""
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="width:52px;height:52px;border-radius:14px;background:{T['brand']}22;display:grid;place-items:center;flex:none">
          <div style="font-family:{MONO};font-size:18px;color:{T['brand']}">82</div></div>
        <div>
          <div style="font-size:16px;color:{T['ink']};margin-bottom:4px">Good day to push</div>
          <div style="font-size:13px;color:{T['ink2']};line-height:1.6">
            Seven and a half hours for three nights running, and you have not trained legs since
            the 19th. Aim for a top set above 82.5 kg.
          </div></div>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid {T['ring']}">
        {table(['Lower · squat build','Sets','Target'],
          [['Back squat','4','85 kg'],['Romanian deadlift','3','70 kg'],
           ['Bulgarian split squat','3','24 kg'],['Hanging leg raise','3','12']],
          ['left','right','right'])}
      </div>
      <div style="margin-top:12px">{pill('Start session', T['brand'])}</div>""", '10:30 with Marcus', A)}
    {panel('When we do not know', f"""
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;color:{T['ink2']}">Resting heart rate</div>
          <div style="font-family:{MONO};font-size:16px;color:{T['ink3']}">—</div></div>
        <div style="font-size:11.5px;color:{T['ink3']};margin-top:-8px">No watch connected</div>
        <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid {T['ring']};padding-top:12px">
          <div style="font-size:13px;color:{T['ink2']}">Body fat</div>
          <div style="font-family:{MONO};font-size:16px;color:{T['ink3']}">—</div></div>
        <div style="font-size:11.5px;color:{T['ink3']};margin-top:-8px">Last scan was 4 weeks ago</div>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid {T['ring']};font-size:12px;color:{T['ink3']};line-height:1.6">
        A dash means Repple does not know, not that the number is zero.
      </div>""", None, A)}
  </div>''', who=MEMBER_WHO)

pages['ClientTraining'] = shell('Repple', A, M_NAV, 'Training',
  'Training', '68 sessions · 18 weeks · every set you have logged', f'''
  {kpis([
    kpi('Sessions','68','4 a week average'),
    kpi('Volume · this week','5,100','kg lifted · one session so far'),
    kpi('Personal records','9','3 this month', T['good']),
    kpi('Longest streak','23','days'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:16px">
    {panel('Squat · every top set', "".join([
        bar_row('Week 12','62','72.5 kg'), bar_row('Week 13','66','75 kg'),
        bar_row('Week 14','66','75 kg'), bar_row('Week 15','72','80 kg'),
        bar_row('Week 16','76','82.5 kg'), bar_row('Week 17','60','65 kg · deload', T['warn']),
        bar_row('Week 18','88','82.5 kg · PR', T['good']),
    ]), None, A)}
    {panel('Records', table(
      ['Lift','Best','When'],
      [['Back squat','82.5 kg × 5','19 Aug'],['Deadlift','120 kg × 3','12 Aug'],
       ['Bench press','52.5 kg × 5','4 Aug'],['Hip thrust','140 kg × 8','29 Jul']],
      ['left','right','right']), 'four of nine', A)}
  </div>
  <div style="height:16px"></div>
  {panel('Recent sessions', table(
    ['Date','Session','Logged by','Volume','Felt'],
    [['Yesterday','Upper push','Marcus Vaughn','5,100 kg','Good'],
     ['24 Aug','Lower · hinge','You','7,900 kg','Good'],
     ['23 Aug','Conditioning','You','—','Easy'],
     ['21 Aug','Upper pull','Marcus Vaughn','4,860 kg','Good'],
     ['19 Aug','Lower · squat build','You','8,240 kg','Hard']],
    ['left','left','left','right','right']), 'five', A)}''', who=MEMBER_WHO)

pages['ClientNutrition'] = shell('Repple', A, M_NAV, 'Nutrition',
  'Nutrition', 'What you ate today, against a target that changed in week 15', f'''
  {kpis([
    kpi('Eaten today','940','kcal of 2,180'),
    kpi('Protein','78','g of 130', T['warn']),
    kpi('Burned','~420','kcal · estimated from the work logged'),
    kpi('Average · 7 days','2,090','kcal'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1fr 1.1fr;gap:16px">
    {panel('Today', table(
      ['Meal','Item','kcal','P'],
      [['Breakfast','Greek yoghurt, berries, honey','340','24'],
       ['Snack','Whey, banana','280','28'],
       ['Lunch','Chicken, rice, salad','320','26'],
       ['Dinner','—','—','—'],
       ['Left','','1,240','52']],
      ['left','left','right','right']), '3 logged', A)}
    {panel('Why your target moved', f"""
      <div style="font-size:13px;color:{T['ink2']};line-height:1.6;margin-bottom:14px">
        Protein went from 110 g to 130 g in week 15, when your training volume rose and your weight
        had been flat for eleven days. Calories followed your last scan, not the weight on the scale.
      </div>
      {table(['Changed','From','To','Why'],
        [['Protein','110 g','130 g','Volume up'],
         ['Calories','2,320','2,180','Scan · week 15'],
         ['Carbs','240 g','218 g','Follows calories']],
        ['left','right','right','left'])}""", None, A)}
  </div>''', who=MEMBER_WHO)

pages['ClientProgress'] = shell('Repple', A, M_NAV, 'Progress',
  'Progress', '18 weeks · weight, composition and the photos', f'''
  {kpis([
    kpi('Weight','−2.1','kg since April', T['good']),
    kpi('Body fat','−1.4','pts · last scan 30 Jul', T['good']),
    kpi('Muscle','+0.8','kg', T['good']),
    kpi('Since last scan','28','days · book another', T['warn']),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px">
    {panel('Weight · weekly average', "".join([
        bar_row('Week 1','88','68.4 kg'), bar_row('Week 5','84','67.9 kg'),
        bar_row('Week 9','80','67.1 kg'), bar_row('Week 13','74','66.6 kg'),
        bar_row('Week 15','74','66.6 kg · flat', T['warn']),
        bar_row('Week 18','68','66.3 kg', T['good']),
    ]), 'six of eighteen', A)}
    {panel('Body composition', f"""
      {table(['Scan','Weight','Body fat','Muscle'],
        [['21 Apr','68.4 kg','29.1%','24.2 kg'],
         ['2 Jun','67.2 kg','28.0%','24.7 kg'],
         ['30 Jul','66.3 kg','27.7%','25.0 kg'],
         ['Next','—','—','—']],
        ['left','right','right','right'])}
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid {T['ring']};font-size:12px;color:{T['ink3']};line-height:1.6">
        The next row is dashes because the scan has not happened. Repple will not project it.
      </div>""", None, A)}
  </div>''', who=MEMBER_WHO)

pages['ClientBookings'] = shell('Repple', A, M_NAV, 'Bookings',
  'Bookings', 'Your sessions, classes and what you have paid for', f'''
  {kpis([
    kpi('PT sessions left','8','in your current pack'),
    kpi('Booked this week','3','2 classes, 1 PT'),
    kpi('Membership','Unlimited','renews 1 September'),
    kpi('Attended · 30 days','14','of 16 booked'),
  ])}
  <div style="height:16px"></div>
  <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px">
    {panel('Coming up', table(
      ['When','What','With','Status'],
      [['Today 10:30','PT · lower','Marcus Vaughn', pill('Booked', T['brand'])],
       ['Wed 17:30','Strength 45','Marcus Vaughn', pill('Booked', T['brand'])],
       ['Thu 07:00','HIIT 45','Priya Raman', pill('Waitlist · 2nd', T['warn'])],
       ['Sat 09:30','Reformer','Nadia Cole', pill('Places free', T['ink3'])]],
      ['left','left','left','right']), 'four', A)}
    {panel('Your pack', f"""
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
        <div style="font-family:{MONO};font-size:34px;color:{T['ink']}">8</div>
        <div style="font-size:13px;color:{T['ink3']}">of 12 sessions left</div>
      </div>
      <div style="height:7px;border-radius:4px;background:{T['surface3']};overflow:hidden;margin-bottom:12px">
        <div style="height:100%;width:67%;background:{T['brand']}"></div></div>
      {table(['Bought','Used','Expires'], [['12 Jul','4','12 Oct']], ['left','right','right'])}
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid {T['ring']};font-size:12px;color:{T['ink3']};line-height:1.6">
        If this cannot be read it shows a dash, not a zero. You have paid for these; you should never
        be told you have none because a query failed.
      </div>""", None, A)}
  </div>''', who=MEMBER_WHO)

# Main.dc.html is the canvas entry file; it holds the Studio overview.
out = pathlib.Path('.')
for name, html in pages.items():
    (out / f'{name}.dc.html').write_text(html, encoding='utf-8')
print(f'wrote {len(pages)} artboards:', ', '.join(sorted(pages)))
