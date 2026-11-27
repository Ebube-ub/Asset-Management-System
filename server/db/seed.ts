/**
 * Demo data for I4nnova Asset Management (Release 1).
 * Seeded only when the database is empty, so it never touches live records.
 */
import { one, query } from './index.js';
import { hashPassword } from '../lib/auth.js';
import type { Role } from '../../shared/domain.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);

type StaffSeed = {
  key: string;
  name: string;
  email: string;
  jobTitle: string;
  manager?: string;
  roles: Role[];
  firstSignedIn?: boolean;
  left?: boolean;
};

const STAFF: StaffSeed[] = [
  { key: 'chinedu', name: 'Chinedu Balogun', email: 'chinedu.balogun@i4nnova.com', jobTitle: 'Chief Operating Officer (second financial approver)', roles: ['line_manager', 'financial_executive'] },
  { key: 'ngozi', name: 'Ngozi Adeyemi', email: 'ngozi.adeyemi@i4nnova.com', jobTitle: 'Executive, Financial Matters', manager: 'chinedu', roles: ['financial_executive', 'line_manager'] },
  { key: 'emeka', name: 'Emeka Nwosu', email: 'emeka.nwosu@i4nnova.com', jobTitle: 'Head of Operations', manager: 'chinedu', roles: ['line_manager', 'team_lead'] },
  { key: 'grace', name: 'Grace Okafor', email: 'grace.okafor@i4nnova.com', jobTitle: 'People & Operations Administrator', manager: 'chinedu', roles: ['administrator'] },
  { key: 'ibrahim', name: 'Ibrahim Musa', email: 'ibrahim.musa@i4nnova.com', jobTitle: 'Engineering Team Lead', manager: 'emeka', roles: ['team_lead'] },
  { key: 'bola', name: 'Bola Adeleke', email: 'bola.adeleke@i4nnova.com', jobTitle: 'Facilities Team Lead', manager: 'emeka', roles: ['team_lead'] },
  { key: 'fatima', name: 'Fatima Bello', email: 'fatima.bello@i4nnova.com', jobTitle: 'Stock Manager', manager: 'emeka', roles: ['stock_manager'] },
  { key: 'chiamaka', name: 'Chiamaka Uche', email: 'chiamaka.uche@i4nnova.com', jobTitle: 'Finance Analyst', manager: 'ngozi', roles: ['team_lead'] },
  { key: 'zainab', name: 'Zainab Yusuf', email: 'zainab.yusuf@i4nnova.com', jobTitle: 'Software Engineer', manager: 'ibrahim', roles: [] },
  { key: 'daniel', name: 'Daniel Eze', email: 'daniel.eze@i4nnova.com', jobTitle: 'Product Designer', manager: 'ibrahim', roles: [] },
  { key: 'halima', name: 'Halima Sani', email: 'halima.sani@i4nnova.com', jobTitle: 'QA Engineer', manager: 'ibrahim', roles: [] },
  { key: 'kelechi', name: 'Kelechi Obi', email: 'kelechi.obi@i4nnova.com', jobTitle: 'Facilities Officer', manager: 'bola', roles: [] },
  { key: 'peter', name: 'Peter Akpan', email: 'peter.akpan@i4nnova.com', jobTitle: 'Operations Associate', manager: 'bola', roles: [] },
  { key: 'somto', name: 'Somtochukwu Ibe', email: 'somtochukwu.ibe@i4nnova.com', jobTitle: 'Graduate Analyst', manager: 'ibrahim', roles: [], firstSignedIn: false },
  { key: 'tobi', name: 'Tobi Lawal', email: 'tobi.lawal@i4nnova.com', jobTitle: 'Data Analyst', manager: 'chiamaka', roles: [] },
  { key: 'ifeoma', name: 'Ifeoma Chukwu', email: 'ifeoma.chukwu@i4nnova.com', jobTitle: 'Executive Assistant', manager: 'chinedu', roles: [] },
  { key: 'samuel', name: 'Samuel Ojo', email: 'samuel.ojo@i4nnova.com', jobTitle: 'IT Support Officer', manager: 'ibrahim', roles: [] },
  { key: 'amara', name: 'Amara Nnaji', email: 'amara.nnaji@i4nnova.com', jobTitle: 'Operations Analyst', manager: 'emeka', roles: [], left: true },
];

const ROOMS = [
  { key: 'openplan', name: '3rd Floor Open Plan', building: 'I4nnova HQ', floor: '3' },
  { key: 'finance', name: 'Finance Wing', building: 'I4nnova HQ', floor: '3' },
  { key: 'ops', name: 'Operations Room', building: 'I4nnova HQ', floor: '2' },
  { key: 'boardroom', name: 'Boardroom', building: 'I4nnova HQ', floor: '2' },
  { key: 'server', name: 'Server Room', building: 'I4nnova HQ', floor: '1' },
  { key: 'training', name: 'Training Room', building: 'I4nnova HQ', floor: '1' },
];

const CLASSES = [
  { name: 'IT Equipment', description: 'Computers, peripherals, networking and communications equipment.' },
  { name: 'Office Equipment', description: 'General office machinery and presentation equipment.' },
  { name: 'Furniture', description: 'Desks, seating and other workplace furniture.' },
  { name: 'Facilities Equipment', description: 'Building services equipment such as air conditioning and power.' },
  { name: 'Vehicles', description: 'Company vehicles and mobile plant.' },
];

const CATEGORIES = [
  { key: 'computing', class: 'IT Equipment', name: 'Computing Devices', description: 'Laptops, desktops, monitors and phones.' },
  { key: 'networking', class: 'IT Equipment', name: 'Networking Equipment', description: 'Switches, routers and access points.' },
  { key: 'seating', class: 'Furniture', name: 'Office Seating', description: 'Chairs and stools for workstations.' },
  { key: 'desks', class: 'Furniture', name: 'Desks and Tables', description: 'Workstations, standing desks and meeting tables.' },
  { key: 'presentation', class: 'Office Equipment', name: 'Presentation Equipment', description: 'Projectors, screens and conference equipment.' },
  { key: 'aircon', class: 'Facilities Equipment', name: 'Air Conditioning', description: 'Split and central cooling units.' },
];

const TYPES = [
  { key: 'laptop', name: 'Dell Latitude 7440 Laptop', custody: 'person', category: 'Computing Devices' },
  { key: 'monitor', name: 'HP EliteDisplay E24 Monitor', custody: 'person', category: 'Computing Devices' },
  { key: 'phone', name: 'Cisco 8841 IP Phone', custody: 'person', category: 'Computing Devices' },
  { key: 'chair', name: 'Herman Miller Aeron Chair', custody: 'person', category: 'Office Seating' },
  { key: 'desk', name: 'Motion Standing Desk', custody: 'person', category: 'Desks and Tables' },
  { key: 'projector', name: 'Epson EB-L200 Projector', custody: 'location', category: 'Presentation Equipment' },
  { key: 'ac', name: 'Split Air Conditioner 1.5HP', custody: 'location', category: 'Air Conditioning' },
  { key: 'switch', name: 'Cisco Catalyst 24-Port Switch', custody: 'location', category: 'Networking Equipment' },
];

export async function seedIfEmpty(): Promise<void> {
  const count = await one<{ c: number }>(`select count(*)::int as c from staff`);
  if (count && count.c > 0) return;
  console.log('Seeding I4nnova demo data…');
  await seed();
  console.log('Demo data ready.');
}

async function seed() {
  const password = hashPassword('Password123!');
  const staff: Record<string, string> = {};
  const rooms: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const categories: Record<string, string> = {};
  const types: Record<string, string> = {};

  for (const s of STAFF) {
    staff[s.key] = crypto.randomUUID();
  }

  for (const s of STAFF) {
    await query(
      `insert into staff (id, name, email, password_hash, job_title, manager_id, first_signed_in_at, left_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        staff[s.key],
        s.name,
        s.email,
        password,
        s.jobTitle,
        s.manager ? staff[s.manager] : null,
        s.firstSignedIn === false ? null : daysAgo(60),
        s.left ? daysAgo(3) : null,
        daysAgo(120),
      ],
    );
    for (const role of s.roles) {
      await query(`insert into staff_role (staff_id, role) values ($1,$2)`, [staff[s.key], role]);
    }
  }

  for (const r of ROOMS) {
    rooms[r.key] = crypto.randomUUID();
    await query(`insert into room (id, name, building, floor) values ($1,$2,$3,$4)`, [
      rooms[r.key],
      r.name,
      r.building,
      r.floor,
    ]);
  }

  for (const c of CLASSES) {
    classes[c.name] = crypto.randomUUID();
    await query(`insert into asset_class (id, name, description) values ($1,$2,$3)`, [
      classes[c.name],
      c.name,
      c.description,
    ]);
  }

  for (const c of CATEGORIES) {
    categories[c.name] = crypto.randomUUID();
    await query(
      `insert into asset_category (id, class_id, name, description) values ($1,$2,$3,$4)`,
      [categories[c.name], classes[c.class], c.name, c.description],
    );
  }

  for (const t of TYPES) {
    types[t.key] = crypto.randomUUID();
    await query(
      `insert into asset_type (id, name, custody_kind, category, category_id, description)
       values ($1,$2,$3,$4,$5,$6)`,
      [types[t.key], t.name, t.custody, t.category, categories[t.category], null],
    );
  }

  await query(
    `insert into scoring_weights (id, price, quality, delivery, warranty, set_by, is_active, effective_from)
     values ($1,40,30,15,15,$2,true,$3)`,
    [crypto.randomUUID(), staff.grace, daysAgo(100)],
  );
  await query(`insert into app_setting (key, value) values ('parked_review_days','7')`);
  await query(`insert into app_setting (key, value) values ('second_approver_id',$1)`, [staff.chinedu]);

  // ------------------------------------------------------------------
  // Assets
  // ------------------------------------------------------------------
  let assetSeq = 0;
  const assetIds: Record<string, string> = {};

  async function addAsset(opts: {
    key: string;
    type: string;
    serial?: string;
    condition?: string;
    status?: string;
    holder?: string;
    room?: string;
    purchaseId?: string | null;
    requestItemId?: string | null;
    notes?: string | null;
    registeredDaysAgo?: number;
  }) {
    assetSeq += 1;
    const ref = `AST-${String(assetSeq).padStart(5, '0')}`;
    const id = crypto.randomUUID();
    assetIds[opts.key] = id;
    await query(
      `insert into asset (id, ref, asset_type_id, serial_number, condition, status, holder_staff_id, room_id,
                          purchase_id, request_item_id, registered_at, registered_by, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        ref,
        types[opts.type],
        opts.serial ?? null,
        opts.condition ?? 'good',
        opts.status ?? 'available',
        opts.holder ? staff[opts.holder] : null,
        opts.room ? rooms[opts.room] : null,
        opts.purchaseId ?? null,
        opts.requestItemId ?? null,
        daysAgo(opts.registeredDaysAgo ?? 90),
        staff.fatima,
        opts.notes ?? null,
      ],
    );
    await query(
      `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, at, note)
       values ($1,$2,'AssetRegistered',null,$3,$4,$5,$6)`,
      [
        crypto.randomUUID(),
        id,
        opts.status === 'assigned'
          ? opts.holder
            ? STAFF.find((s) => s.key === opts.holder)?.name
            : ROOMS.find((r) => r.key === opts.room)?.name
          : null,
        staff.fatima,
        daysAgo(opts.registeredDaysAgo ?? 90),
        'Entered the asset register.',
      ],
    );
    if (opts.status === 'assigned') {
      await query(
        `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, at, note)
         values ($1,$2,'AssetAssigned',null,$3,$4,$5,$6)`,
        [
          crypto.randomUUID(),
          id,
          opts.holder
            ? STAFF.find((s) => s.key === opts.holder)?.name
            : ROOMS.find((r) => r.key === opts.room)?.name,
          staff.fatima,
          daysAgo((opts.registeredDaysAgo ?? 90) - 1),
          'Issued to its holder.',
        ],
      );
    }
    return id;
  }

  // Unassigned stock
  const stockLaptops = ['LT-7440-1001', 'LT-7440-1002', 'LT-7440-1003', 'LT-7440-1004'];
  for (let i = 0; i < stockLaptops.length; i++) {
    await addAsset({ key: `stock-laptop-${i}`, type: 'laptop', serial: stockLaptops[i], condition: 'new', registeredDaysAgo: 40 + i });
  }
  for (let i = 0; i < 5; i++) {
    await addAsset({ key: `stock-monitor-${i}`, type: 'monitor', serial: `HP-E24-22${i}0`, condition: 'good', registeredDaysAgo: 30 + i });
  }
  for (let i = 0; i < 2; i++) {
    await addAsset({ key: `stock-chair-${i}`, type: 'chair', serial: `HM-AER-33${i}1`, condition: 'good', registeredDaysAgo: 55 });
  }
  for (let i = 0; i < 2; i++) {
    await addAsset({ key: `stock-desk-${i}`, type: 'desk', serial: `MS-DSK-77${i}2`, condition: 'fair', registeredDaysAgo: 70 });
  }
  await addAsset({ key: 'stock-phone-0', type: 'phone', serial: 'CS-8841-4410', condition: 'good', registeredDaysAgo: 65 });

  // Assigned devices
  const assigned: [string, string, string][] = [
    ['zainab', 'laptop', 'LT-7440-0512'],
    ['daniel', 'laptop', 'LT-7440-0513'],
    ['halima', 'laptop', 'LT-7440-0514'],
    ['ibrahim', 'laptop', 'LT-7440-0515'],
    ['bola', 'laptop', 'LT-7440-0516'],
    ['fatima', 'laptop', 'LT-7440-0517'],
    ['ngozi', 'laptop', 'LT-7440-0518'],
    ['emeka', 'laptop', 'LT-7440-0519'],
    ['chinedu', 'laptop', 'LT-7440-0520'],
    ['grace', 'laptop', 'LT-7440-0521'],
    ['chiamaka', 'laptop', 'LT-7440-0522'],
    ['zainab', 'monitor', 'HP-E24-1001'],
    ['daniel', 'monitor', 'HP-E24-1002'],
    ['halima', 'monitor', 'HP-E24-1003'],
    ['kelechi', 'monitor', 'HP-E24-1004'],
    ['peter', 'monitor', 'HP-E24-1005'],
    ['ifeoma', 'monitor', 'HP-E24-1006'],
    ['samuel', 'monitor', 'HP-E24-1007'],
    ['zainab', 'chair', 'HM-AER-2001'],
    ['daniel', 'chair', 'HM-AER-2002'],
    ['ibrahim', 'chair', 'HM-AER-2003'],
    ['bola', 'chair', 'HM-AER-2004'],
    ['halima', 'chair', 'HM-AER-2005'],
    ['zainab', 'phone', 'CS-8841-3001'],
    ['daniel', 'phone', 'CS-8841-3002'],
    ['samuel', 'phone', 'CS-8841-3003'],
  ];
  for (let i = 0; i < assigned.length; i++) {
    const [holder, type, serial] = assigned[i];
    await addAsset({
      key: `assigned-${i}`,
      type,
      serial,
      condition: i % 5 === 0 ? 'fair' : 'good',
      status: 'assigned',
      holder,
      registeredDaysAgo: 100 - i,
    });
  }

  // Location-held equipment
  await addAsset({ key: 'loc-ac-ops', type: 'ac', serial: 'AC-15HP-8801', status: 'assigned', room: 'ops', registeredDaysAgo: 80 });
  await addAsset({ key: 'loc-ac-fin', type: 'ac', serial: 'AC-15HP-8802', status: 'assigned', room: 'finance', registeredDaysAgo: 80 });
  await addAsset({ key: 'loc-proj-board', type: 'projector', serial: 'EP-L200-5501', status: 'assigned', room: 'boardroom', registeredDaysAgo: 60 });
  await addAsset({ key: 'loc-proj-train', type: 'projector', serial: 'EP-L200-5502', status: 'assigned', room: 'training', registeredDaysAgo: 60 });
  await addAsset({ key: 'loc-switch-server', type: 'switch', serial: 'CS-CAT-9921', status: 'assigned', room: 'server', registeredDaysAgo: 110 });
  await addAsset({ key: 'loc-switch-ops', type: 'switch', serial: 'CS-CAT-9922', status: 'available', registeredDaysAgo: 110 });

  // Disposal candidates
  const obsoleteLaptop = await addAsset({
    key: 'old-laptop',
    type: 'laptop',
    serial: 'LT-6440-0091',
    condition: 'poor',
    status: 'awaiting_disposal',
    registeredDaysAgo: 400,
    notes: 'Failing motherboard, out of warranty.',
  });
  const auctionDesk = await addAsset({
    key: 'auction-desk',
    type: 'desk',
    serial: 'MS-DSK-1101',
    condition: 'fair',
    status: 'awaiting_disposal',
    registeredDaysAgo: 380,
  });
  const donatedChair = await addAsset({
    key: 'donated-chair',
    type: 'chair',
    serial: 'HM-AER-0090',
    condition: 'poor',
    status: 'disposed',
    registeredDaysAgo: 420,
  });
  const rejectedChair = await addAsset({
    key: 'rejected-chair',
    type: 'chair',
    serial: 'HM-AER-0091',
    condition: 'fair',
    status: 'available',
    registeredDaysAgo: 400,
  });

  // ------------------------------------------------------------------
  // Requests
  // ------------------------------------------------------------------
  let requestSeq = 0;

  type ItemState = { status: string; reason?: string; reviewDueAt?: Date | null; issuedAssetId?: string | null };

  async function addRequest(opts: {
    raisedBy: string;
    raisedFor: string;
    justification: string;
    priority: string;
    priorityJustification?: string | null;
    businessImpact?: string | null;
    status: string;
    reviewer?: string | null;
    daysAgo: number;
    lines: {
      type: string;
      quantity: number;
      room?: string;
      items: ItemState[];
      quotes?: { vendor: string; amount: number; delivery: number; warranty: number; quality: number }[];
      chosenQuoteIndex?: number;
      choiceReason?: string | null;
      decision?: { decision: string; amount?: number; by?: string; note?: string };
      purchase?: { vendor: string; cost: number; daysAgo: number };
      assets?: { serial: string; condition?: string; holder?: string; room?: string }[];
    }[];
    history: { event: string; by: string; note: string; hoursAgo: number }[];
  }) {
    requestSeq += 1;
    const ref = `REQ-${new Date().getFullYear()}-${String(requestSeq).padStart(4, '0')}`;
    const requestId = crypto.randomUUID();
    const raisedAt = daysAgo(opts.daysAgo);
    await query(
      `insert into request (id, ref, raised_by, raised_for, raised_at, justification, priority,
                            priority_justification, business_impact, status, current_reviewer_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        requestId,
        ref,
        staff[opts.raisedBy],
        staff[opts.raisedFor],
        raisedAt,
        opts.justification,
        opts.priority,
        opts.priorityJustification ?? null,
        opts.businessImpact ?? null,
        opts.status,
        opts.reviewer ? staff[opts.reviewer] : null,
      ],
    );

    let lineIndex = 0;
    for (const line of opts.lines) {
      lineIndex += 1;
      const lineId = crypto.randomUUID();
      await query(
        `insert into request_line (id, request_id, asset_type_id, quantity, recipient_room_id)
         values ($1,$2,$3,$4,$5)`,
        [lineId, requestId, types[line.type], line.quantity, line.room ? rooms[line.room] : null],
      );
      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i];
        await query(
          `insert into request_item (id, request_line_id, seq, status, closed_reason, review_due_at, issued_asset_id, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            crypto.randomUUID(),
            lineId,
            i + 1,
            item.status,
            item.reason ?? null,
            item.reviewDueAt ?? null,
            item.issuedAssetId ?? null,
            raisedAt,
          ],
        );
      }

      if (line.quotes?.length) {
        const quoteIds: string[] = [];
        for (let i = 0; i < line.quotes.length; i++) {
          const q = line.quotes[i];
          const qid = crypto.randomUUID();
          quoteIds.push(qid);
          await query(
            `insert into quote (id, request_line_id, vendor_name, amount, delivery_days, warranty_months,
                                quality_rating, document_url, document_name, recorded_by, recorded_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              qid,
              lineId,
              q.vendor,
              q.amount,
              q.delivery,
              q.warranty,
              q.quality,
              null,
              `${q.vendor.replace(/\s+/g, '-').toLowerCase()}-quotation.pdf`,
              staff.fatima,
              daysAgo(Math.max(0, opts.daysAgo - 2)),
            ],
          );
        }
        const chosenIdx = line.chosenQuoteIndex ?? 0;
        // Work out the recommendation with the default weights so the stored choice is truthful.
        const cheapest = Math.min(...line.quotes.map((q) => q.amount));
        const fastest = Math.min(...line.quotes.map((q) => Math.max(1, q.delivery)));
        const longestWarranty = Math.max(...line.quotes.map((q) => q.warranty));
        const scores = line.quotes.map((q) => ({
          score:
            (cheapest / q.amount) * 0.4 +
            (q.quality / 5) * 0.3 +
            (fastest / Math.max(1, q.delivery)) * 0.15 +
            (longestWarranty > 0 ? q.warranty / longestWarranty : 0) * 0.15,
          amount: q.amount,
        }));
        let bestIdx = 0;
        for (let i = 1; i < scores.length; i++) {
          if (scores[i].score > scores[bestIdx].score) bestIdx = i;
        }
        await query(
          `insert into quote_choice (id, request_line_id, recommended_quote_id, chosen_quote_id, weights_used, reason, chosen_by, chosen_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            crypto.randomUUID(),
            lineId,
            quoteIds[bestIdx],
            quoteIds[chosenIdx],
            JSON.stringify({ price: 40, quality: 30, delivery: 15, warranty: 15 }),
            line.choiceReason ?? null,
            staff.fatima,
            daysAgo(Math.max(0, opts.daysAgo - 3)),
          ],
        );

        if (line.decision) {
          await query(
            `insert into financial_decision (id, request_line_id, decision, approved_amount, decided_by, decided_at, note)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [
              crypto.randomUUID(),
              lineId,
              line.decision.decision,
              line.decision.amount ?? null,
              staff[line.decision.by ?? 'ngozi'],
              daysAgo(Math.max(0, opts.daysAgo - 4)),
              line.decision.note ?? null,
            ],
          );
        }

        if (line.purchase) {
          const purchaseId = crypto.randomUUID();
          const chosenAmount = line.quotes[chosenIdx]?.amount ?? 0;
          await query(
            `insert into purchase (id, request_line_id, quote_id, vendor_name, cost, receipt_url, receipt_name, recorded_by, recorded_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              purchaseId,
              lineId,
              quoteIds[chosenIdx],
              line.purchase.vendor,
              line.purchase.cost,
              null,
              `${line.purchase.vendor.replace(/\s+/g, '-').toLowerCase()}-receipt.pdf`,
              staff.fatima,
              daysAgo(line.purchase.daysAgo),
            ],
          );
          if (line.assets?.length) {
            for (let i = 0; i < line.assets.length; i++) {
              const a = line.assets[i];
              await addAsset({
                key: `${ref}-asset-${lineIndex}-${i}`,
                type: line.type,
                serial: a.serial,
                condition: a.condition ?? 'new',
                status: a.holder || a.room ? 'assigned' : 'available',
                holder: a.holder,
                room: a.room,
                purchaseId,
                registeredDaysAgo: Math.max(0, (line.purchase?.daysAgo ?? 1) - 1),
                notes: `Purchased from ${line.purchase.vendor} · approved ₦${chosenAmount.toLocaleString()} · cost ₦${line.purchase.cost.toLocaleString()}.`,
              });
            }
          }
        }
      }
    }

    for (const h of opts.history) {
      await query(
        `insert into request_history (id, request_id, event, by_staff_id, at, note)
         values ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), requestId, h.event, staff[h.by], hoursAgo(h.hoursAgo), h.note],
      );
    }

    return { id: requestId, ref, lineCount: opts.lines.length };
  }

  // 1 — Partial stock: 3 of 5 laptops issued, 2 awaiting quotation
  const partial = await addRequest({
    raisedBy: 'zainab',
    raisedFor: 'zainab',
    justification:
      'Three new engineers joining the platform team need laptops, and two of the current machines are failing their battery health checks.',
    priority: 'high',
    priorityJustification: 'Onboarding starts Monday and the failing machines cannot run the build tooling.',
    businessImpact: 'Delivery of the Q1 platform milestone slips without working developer machines.',
    status: 'in_progress',
    daysAgo: 9,
    lines: [
      {
        type: 'laptop',
        quantity: 5,
        items: [
          { status: 'issued', issuedAssetId: assetIds['assigned-0'] },
          { status: 'issued', issuedAssetId: assetIds['assigned-1'] },
          { status: 'issued', issuedAssetId: assetIds['assigned-2'] },
          { status: 'awaiting_quotation' },
          { status: 'awaiting_quotation' },
        ],
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'zainab', note: 'Priority high.', hoursAgo: 218 },
      { event: 'RequestPassedReview', by: 'ibrahim', note: 'Agreed — machines are genuinely failing.', hoursAgo: 200 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 190 },
      { event: 'ItemIssued', by: 'fatima', note: 'Issued 3 laptops from stock. 2 units short — sent for quotations.', hoursAgo: 170 },
    ],
  });

  // 2 — In stock: monitor issued and fulfilled
  await addRequest({
    raisedBy: 'daniel',
    raisedFor: 'daniel',
    justification: 'Requesting a second monitor for design work; the current single screen makes side-by-side review impractical.',
    priority: 'medium',
    status: 'fulfilled',
    daysAgo: 16,
    lines: [
      {
        type: 'monitor',
        quantity: 1,
        items: [{ status: 'issued', issuedAssetId: assetIds['assigned-12'] }],
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'daniel', note: 'Priority medium.', hoursAgo: 384 },
      { event: 'RequestPassedReview', by: 'ibrahim', note: 'Reasonable request.', hoursAgo: 360 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 350 },
      { event: 'ItemIssued', by: 'fatima', note: 'Issued HP-E24-1002 from stock.', hoursAgo: 330 },
      { event: 'RequestCompleted', by: 'fatima', note: 'Request fulfilled.', hoursAgo: 330 },
    ],
  });

  // 3 — No stock: quotes recorded, chosen, awaiting the financial decision
  const noStock = await addRequest({
    raisedBy: 'halima',
    raisedFor: 'halima',
    justification:
      'My current laptop no longer holds charge and cannot run the automated test suite; a replacement is needed to continue release testing.',
    priority: 'medium',
    status: 'in_progress',
    daysAgo: 6,
    lines: [
      {
        type: 'laptop',
        quantity: 1,
        items: [{ status: 'awaiting_decision' }],
        quotes: [
          { vendor: 'Konga Business', amount: 1_250_000, delivery: 7, warranty: 12, quality: 4 },
          { vendor: 'Slot Systems', amount: 1_150_000, delivery: 10, warranty: 6, quality: 3 },
          { vendor: 'Task Systems Ltd', amount: 1_340_000, delivery: 3, warranty: 24, quality: 5 },
        ],
        chosenQuoteIndex: 2,
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'halima', note: 'Priority medium.', hoursAgo: 150 },
      { event: 'RequestPassedReview', by: 'ibrahim', note: 'Confirmed the machine is failing.', hoursAgo: 130 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 120 },
      { event: 'StockChecked', by: 'fatima', note: 'No stock available — sent for vendor quotations.', hoursAgo: 96 },
      { event: 'QuoteRecorded', by: 'fatima', note: 'Three quotations recorded and compared.', hoursAgo: 72 },
      { event: 'QuoteChosen', by: 'fatima', note: 'Chose Task Systems Ltd at ₦1,340,000 (recommended) for the 24-month warranty.', hoursAgo: 70 },
    ],
  });

  // 4 — Under review at the team lead
  const underReview = await addRequest({
    raisedBy: 'kelechi',
    raisedFor: 'kelechi',
    justification: 'The chair at my desk has a broken gas lift and cannot be adjusted, which is causing back pain.',
    priority: 'medium',
    status: 'under_review',
    reviewer: 'bola',
    daysAgo: 2,
    lines: [{ type: 'chair', quantity: 2, items: [{ status: 'requested' }, { status: 'requested' }] }],
    history: [{ event: 'RequestRaised', by: 'kelechi', note: 'Priority medium.', hoursAgo: 30 }],
  });

  // 5 — Deferred: parked and due for review
  const parked = await addRequest({
    raisedBy: 'peter',
    raisedFor: 'peter',
    justification: 'Requesting a laptop so I can work from the operations annex during the office refit.',
    priority: 'low',
    status: 'in_progress',
    daysAgo: 21,
    lines: [
      {
        type: 'laptop',
        quantity: 1,
        items: [{ status: 'parked', reviewDueAt: daysAgo(2) }],
        quotes: [
          { vendor: 'Slot Systems', amount: 1_180_000, delivery: 8, warranty: 12, quality: 3 },
          { vendor: 'Konga Business', amount: 1_260_000, delivery: 5, warranty: 12, quality: 4 },
        ],
        chosenQuoteIndex: 0,
        decision: { decision: 'defer', note: 'Park until the refit budget is confirmed in the next cycle.' },
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'peter', note: 'Priority low.', hoursAgo: 504 },
      { event: 'RequestPassedReview', by: 'bola', note: 'Fine by me.', hoursAgo: 480 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 470 },
      { event: 'StockChecked', by: 'fatima', note: 'No stock — two quotations collected.', hoursAgo: 420 },
      { event: 'QuoteChosen', by: 'fatima', note: 'Chose Slot Systems at ₦1,180,000 (recommended).', hoursAgo: 410 },
      { event: 'FinancialDecisionRecorded', by: 'ngozi', note: 'Deferred — parked for review.', hoursAgo: 300 },
    ],
  });

  // 6 — Rejected by the line manager
  await addRequest({
    raisedBy: 'tobi',
    raisedFor: 'tobi',
    justification: 'Requesting a standing desk for the analytics workstation.',
    priority: 'low',
    status: 'rejected',
    daysAgo: 13,
    lines: [{ type: 'desk', quantity: 1, items: [{ status: 'closed', reason: 'declined' }] }],
    history: [
      { event: 'RequestRaised', by: 'tobi', note: 'Priority low.', hoursAgo: 312 },
      { event: 'RequestPassedReview', by: 'chiamaka', note: 'Passing to the line manager.', hoursAgo: 300 },
      { event: 'RequestRejected', by: 'ngozi', note: 'Declined: the desk budget is committed this quarter. Raise again next cycle.', hoursAgo: 280 },
    ],
  });

  // 7 — Approved, waiting for the purchase to be recorded (location-held ACs)
  const approvedAc = await addRequest({
    raisedBy: 'bola',
    raisedFor: 'bola',
    justification: 'The operations room air conditioner has failed and the room is unusable in the afternoon heat.',
    priority: 'high',
    priorityJustification: 'The room is used for daily stand-ups and cannot be occupied above 34°C.',
    businessImpact: 'Daily coordination for the operations team is being disrupted.',
    status: 'in_progress',
    daysAgo: 11,
    lines: [
      {
        type: 'ac',
        quantity: 2,
        room: 'ops',
        items: [{ status: 'approved' }, { status: 'approved' }],
        quotes: [
          { vendor: 'ColdChain Solutions', amount: 980_000, delivery: 4, warranty: 24, quality: 5 },
          { vendor: 'LG Certified Dealer', amount: 890_000, delivery: 9, warranty: 12, quality: 4 },
        ],
        chosenQuoteIndex: 0,
        decision: { decision: 'approve', amount: 980_000, note: 'Approved for the operations room.' },
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'bola', note: 'Priority high.', hoursAgo: 264 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 240 },
      { event: 'StockChecked', by: 'fatima', note: 'No suitable units in stock — quotations requested.', hoursAgo: 200 },
      { event: 'QuoteRecorded', by: 'fatima', note: 'Two quotations recorded.', hoursAgo: 160 },
      { event: 'QuoteChosen', by: 'fatima', note: 'Chose ColdChain Solutions at ₦980,000 (recommended).', hoursAgo: 150 },
      { event: 'FinancialDecisionRecorded', by: 'ngozi', note: 'Approved — ₦980,000.', hoursAgo: 120 },
    ],
  });

  // 8 — Purchased and waiting to be issued
  const purchased = await addRequest({
    raisedBy: 'ifeoma',
    raisedFor: 'ifeoma',
    justification: 'Replacement laptop — the current device is four years old and out of warranty.',
    priority: 'medium',
    status: 'in_progress',
    daysAgo: 18,
    lines: [
      {
        type: 'laptop',
        quantity: 1,
        items: [{ status: 'purchased' }],
        quotes: [
          { vendor: 'Task Systems Ltd', amount: 1_290_000, delivery: 5, warranty: 24, quality: 5 },
          { vendor: 'Slot Systems', amount: 1_210_000, delivery: 9, warranty: 12, quality: 3 },
        ],
        chosenQuoteIndex: 0,
        decision: { decision: 'approve', amount: 1_290_000 },
        purchase: { vendor: 'Task Systems Ltd', cost: 1_290_000, daysAgo: 4 },
        assets: [{ serial: 'LT-7440-0610' }],
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'ifeoma', note: 'Priority medium.', hoursAgo: 432 },
      { event: 'RequestPassedReview', by: 'chinedu', note: 'Passed to the stock check by the line manager.', hoursAgo: 410 },
      { event: 'StockChecked', by: 'fatima', note: 'No stock — quotations requested.', hoursAgo: 380 },
      { event: 'QuoteChosen', by: 'fatima', note: 'Chose Task Systems Ltd at ₦1,290,000 (recommended).', hoursAgo: 340 },
      { event: 'FinancialDecisionRecorded', by: 'ngozi', note: 'Approved — ₦1,290,000.', hoursAgo: 300 },
      { event: 'PurchaseRecorded', by: 'fatima', note: 'Purchase recorded — Task Systems Ltd, ₦1,290,000. Asset registered and ready to issue.', hoursAgo: 96 },
    ],
  });

  // 9 — Declined and closed
  await addRequest({
    raisedBy: 'samuel',
    raisedFor: 'samuel',
    justification: 'Requesting two IP phones for the support desk extension.',
    priority: 'low',
    status: 'closed',
    daysAgo: 25,
    lines: [
      {
        type: 'phone',
        quantity: 2,
        items: [
          { status: 'closed', reason: 'declined' },
          { status: 'closed', reason: 'declined' },
        ],
        quotes: [{ vendor: 'Cisco Partner NG', amount: 340_000, delivery: 6, warranty: 12, quality: 4 }],
        chosenQuoteIndex: 0,
        decision: { decision: 'decline', note: 'Declined: softphones are being rolled out next quarter.' },
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'samuel', note: 'Priority low.', hoursAgo: 600 },
      { event: 'RequestPassedReview', by: 'ibrahim', note: 'Passing on.', hoursAgo: 580 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 570 },
      { event: 'StockChecked', by: 'fatima', note: 'Insufficient stock — one quotation collected.', hoursAgo: 540 },
      { event: 'QuoteChosen', by: 'fatima', note: 'Chose Cisco Partner NG at ₦340,000.', hoursAgo: 530 },
      { event: 'FinancialDecisionRecorded', by: 'ngozi', note: 'Declined.', hoursAgo: 500 },
      { event: 'RequestCompleted', by: 'ngozi', note: 'Request closed — nothing on it was issued.', hoursAgo: 500 },
    ],
  });

  // 10 — Raised by the administrator for a new hire who has never signed in
  await addRequest({
    raisedBy: 'grace',
    raisedFor: 'somto',
    justification:
      'Equipment for Somtochukwu Ibe, who joins the platform team on Monday. Starter kit: laptop and monitor.',
    priority: 'high',
    priorityJustification: 'The new hire starts Monday and cannot work without a machine.',
    businessImpact: 'Onboarding delay for the graduate analyst joining the platform team.',
    status: 'under_review',
    reviewer: 'ibrahim',
    daysAgo: 1,
    lines: [
      { type: 'laptop', quantity: 1, items: [{ status: 'requested' }] },
      { type: 'monitor', quantity: 1, items: [{ status: 'requested' }] },
    ],
    history: [
      { event: 'RequestRaised', by: 'grace', note: 'Raised by the administrator for a new hire who has never signed in. Priority high.', hoursAgo: 20 },
    ],
  });

  // 11 — Awaiting the stock check
  await addRequest({
    raisedBy: 'zainab',
    raisedFor: 'daniel',
    justification: 'Replacement IP phone for the design desk — the handset no longer holds a dial tone.',
    priority: 'medium',
    status: 'in_progress',
    daysAgo: 3,
    lines: [{ type: 'phone', quantity: 1, items: [{ status: 'requested' }] }],
    history: [
      { event: 'RequestRaised', by: 'zainab', note: 'Priority medium.', hoursAgo: 72 },
      { event: 'RequestPassedReview', by: 'ibrahim', note: 'Confirmed the fault.', hoursAgo: 60 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 54 },
    ],
  });

  // 12 — Older fully fulfilled request (chair)
  await addRequest({
    raisedBy: 'zainab',
    raisedFor: 'zainab',
    justification: 'The chair allocated to me has a broken armrest.',
    priority: 'low',
    status: 'fulfilled',
    daysAgo: 40,
    lines: [{ type: 'chair', quantity: 1, items: [{ status: 'issued', issuedAssetId: assetIds['assigned-18'] }] }],
    history: [
      { event: 'RequestRaised', by: 'zainab', note: 'Priority low.', hoursAgo: 960 },
      { event: 'RequestPassedReview', by: 'ibrahim', note: 'Approved.', hoursAgo: 940 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 930 },
      { event: 'ItemIssued', by: 'fatima', note: 'Issued HM-AER-2001 from stock.', hoursAgo: 900 },
      { event: 'RequestCompleted', by: 'fatima', note: 'Request fulfilled.', hoursAgo: 900 },
    ],
  });

  // 13 — Over-budget purchase (flag demo)
  await addRequest({
    raisedBy: 'ibrahim',
    raisedFor: 'samuel',
    justification: 'Network switch replacement for the server room rack — the current unit drops ports under load.',
    priority: 'critical',
    priorityJustification: 'Intermittent network outages are affecting the whole floor.',
    businessImpact: 'Team-wide connectivity outages during peak hours.',
    status: 'in_progress',
    daysAgo: 34,
    lines: [
      {
        type: 'switch',
        quantity: 1,
        room: 'server',
        items: [{ status: 'purchased' }],
        quotes: [{ vendor: 'Netcom Nigeria', amount: 620_000, delivery: 8, warranty: 12, quality: 4 }],
        chosenQuoteIndex: 0,
        decision: { decision: 'approve', amount: 620_000 },
        purchase: { vendor: 'Netcom Nigeria', cost: 705_000, daysAgo: 12 },
        assets: [{ serial: 'CS-CAT-9930' }],
      },
    ],
    history: [
      { event: 'RequestRaised', by: 'ibrahim', note: 'Priority critical.', hoursAgo: 816 },
      { event: 'RequestPassedReview', by: 'emeka', note: 'Passed to the stock check by the line manager.', hoursAgo: 790 },
      { event: 'StockChecked', by: 'fatima', note: 'No spare switch in stock — quotation requested.', hoursAgo: 760 },
      { event: 'QuoteChosen', by: 'fatima', note: 'Chose Netcom Nigeria at ₦620,000.', hoursAgo: 730 },
      { event: 'FinancialDecisionRecorded', by: 'ngozi', note: 'Approved — ₦620,000.', hoursAgo: 700 },
      { event: 'PurchaseRecorded', by: 'fatima', note: 'Purchase recorded — Netcom Nigeria, ₦705,000. This is ₦85,000 over the approved amount.', hoursAgo: 288 },
    ],
  });

  // ------------------------------------------------------------------
  // Disposals
  // ------------------------------------------------------------------
  const disposalRows = [
    { assetId: obsoleteLaptop, method: 'sale', reason: 'Failed motherboard; beyond economical repair. Selling for parts.', status: 'pending', proposedDays: 4 },
    { assetId: auctionDesk, method: 'auction', reason: 'Surplus furniture from the office refit.', status: 'approved', proposedDays: 12, decidedDays: 8 },
    { assetId: donatedChair, method: 'donation', reason: 'Donated to the community library after the refit.', status: 'completed', proposedDays: 60, decidedDays: 55, completedDays: 50, buyer: 'Ijebu Community Library', proceeds: null },
    { assetId: rejectedChair, method: 'scrap', reason: 'Cosmetic damage.', status: 'rejected', proposedDays: 20, decidedDays: 17, note: 'Rejected: the chair is still serviceable. Keep it in stock.' },
  ];
  for (const d of disposalRows) {
    await query(
      `insert into disposal (id, asset_id, method, reason, proposed_by, proposed_at, status, decided_by, decided_at,
                             decision_note, proceeds, buyer, completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        crypto.randomUUID(),
        d.assetId,
        d.method,
        d.reason,
        staff.grace,
        daysAgo(d.proposedDays),
        d.status,
        d.decidedDays ? staff.fatima : null,
        d.decidedDays ? daysAgo(d.decidedDays) : null,
        d.note ?? null,
        d.proceeds ?? null,
        d.buyer ?? null,
        d.completedDays ? daysAgo(d.completedDays) : null,
      ],
    );
    await query(
      `insert into asset_history (id, asset_id, event, by_staff_id, at, note)
       values ($1,$2,'DisposalProposed',$3,$4,$5)`,
      [crypto.randomUUID(), d.assetId, staff.grace, daysAgo(d.proposedDays), `Proposed for ${d.method}. ${d.reason}`],
    );
    if (d.decidedDays) {
      await query(
        `insert into asset_history (id, asset_id, event, by_staff_id, at, note)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          crypto.randomUUID(),
          d.assetId,
          d.status === 'rejected' ? 'DisposalRejected' : 'DisposalApproved',
          staff.fatima,
          daysAgo(d.decidedDays),
          d.status === 'rejected' ? d.note : 'Disposal approved by the stock manager.',
        ],
      );
    }
    if (d.completedDays) {
      await query(
        `insert into asset_history (id, asset_id, event, by_staff_id, at, note)
         values ($1,$2,'AssetDisposed',$3,$4,$5)`,
        [crypto.randomUUID(), d.assetId, staff.fatima, daysAgo(d.completedDays), `Disposed by ${d.method}. Buyer: ${d.buyer}.`],
      );
    }
  }

  // ------------------------------------------------------------------
  // Movements: one pending return, one confirmed transfer
  // ------------------------------------------------------------------
  const pendingReturnAsset = assetIds['assigned-15'];
  await query(
    `insert into asset_movement (id, asset_id, kind, requested_by, requested_at, status, note)
     values ($1,$2,'return',$3,$4,'pending',$5)`,
    [crypto.randomUUID(), pendingReturnAsset, staff.peter, hoursAgo(18), 'Returning the monitor after moving to the annex.'],
  );
  await query(
    `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, at, note)
     values ($1,$2,'ReturnRequested','Peter Akpan','Stock',$3,$4,$5)`,
    [crypto.randomUUID(), pendingReturnAsset, staff.peter, hoursAgo(18), 'Awaiting stock manager confirmation.'],
  );

  const transferAsset = assetIds['assigned-24'];
  await query(
    `insert into asset_movement (id, asset_id, kind, to_staff_id, requested_by, requested_at, status, confirmed_by, confirmed_at, note)
     values ($1,$2,'transfer',$3,$4,$5,'confirmed',$6,$7,$8)`,
    [
      crypto.randomUUID(),
      transferAsset,
      staff.halima,
      staff.daniel,
      daysAgo(6),
      staff.fatima,
      daysAgo(5),
      'Transferred the IP phone to Halima after the desk move.',
    ],
  );
  await query(
    `insert into asset_history (id, asset_id, event, from_holder, to_holder, by_staff_id, at, note)
     values ($1,$2,'AssetTransferred','Daniel Eze','Halima Sani',$3,$4,$5)`,
    [crypto.randomUUID(), transferAsset, staff.fatima, daysAgo(5), 'Confirmed by the stock manager.'],
  );
  await query(`update asset set holder_staff_id = $2 where id = $1`, [transferAsset, staff.halima]);

  // Keep reference sequences ahead of the seeded records.
  await query(`select setval('request_ref_seq', $1)`, [requestSeq + 1]);
  await query(`select setval('asset_ref_seq', $1)`, [assetSeq + 1]);

  // Store the ids used by the acceptance walkthrough so the UI can point at them.
  await query(`insert into app_setting (key, value) values ('demo_partial_request',$1) on conflict do nothing`, [partial.id]);
  await query(`insert into app_setting (key, value) values ('demo_nostock_request',$1) on conflict do nothing`, [noStock.id]);
  await query(`insert into app_setting (key, value) values ('demo_review_request',$1) on conflict do nothing`, [underReview.id]);
  await query(`insert into app_setting (key, value) values ('demo_parked_request',$1) on conflict do nothing`, [parked.id]);
  await query(`insert into app_setting (key, value) values ('demo_approved_ac',$1) on conflict do nothing`, [approvedAc.id]);
  await query(`insert into app_setting (key, value) values ('demo_purchased',$1) on conflict do nothing`, [purchased.id]);
}
