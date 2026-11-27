# Testing guide — prototype feedback round

A walkthrough for checking the changes made after the 27 November prototype meeting. Every scenario
says who to sign in as, where to go, what to do and what you should see.

---

## Before you start

```bash
npm install
npm run dev          # API on http://127.0.0.1:4000, web on http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173** and sign in. Every demo account uses **`Password123!`**.

If you have been experimenting and want the original demo data back, stop the server, delete the
database folder and start again — it re-seeds and re-runs the migrations:

```bash
rm -rf data
npm run dev
```

### Accounts you will need

| Who | Email | Role | Use it for |
| --- | --- | --- | --- |
| Grace Okafor | grace.okafor@i4nnova.com | Administrator | Asset Configuration, approvals, new-hire requests |
| Fatima Bello | fatima.bello@i4nnova.com | Stock Manager | Stock check, releases, handover, returns, purchases |
| Emeka Nwosu | emeka.nwosu@i4nnova.com | Line Manager (Head of Operations) | Line review, group requests |
| Ibrahim Musa | ibrahim.musa@i4nnova.com | Team Lead | First-line review, return-for-editing |
| Zainab Yusuf | zainab.yusuf@i4nnova.com | Staff Member | Raising and editing requests |
| Ngozi Adeyemi | ngozi.adeyemi@i4nnova.com | Financial Executive | Financial approval (regression only) |

Sign out from the profile menu (top right) between roles. Two browser profiles or one normal +
one private window makes the back-and-forth much faster.

---

## 1. Request form — self only, new wording, no recipient field

**Sign in as** Zainab Yusuf → **Go to** Requests → **New request**

- The heading is "New request" and the introduction reads "Tell us what you need and why. The request
  goes to your reviewer first, then to the stock check."
- There is **no field asking who the request is for** anywhere on the page, and no recipient picker.
- "Why do you need it?" has a plain example ("my laptop battery no longer holds charge…") and a
  2,000-character counter.
- "How urgent is it?" shows four priorities with a one-line explanation each, **Medium selected by
  default** and marked DEFAULT.
- A "What happens next" list explains all five steps, including that a returned request is not closed.
- The "Your data" note explains that staff request for themselves only.

Submit a laptop request. **Expect** the request page with status *Under review* and a timeline showing
"Submitted" and the reviewer it went to.

Attempt the bypass: with dev tools open, run

```js
fetch('/api/requests', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    raisedForId: '<another staff member id>',
    justification: 'Bypass attempt',
    priority: 'medium',
    lines: [{ assetTypeId: '<a type id>', quantity: 1 }],
  }),
}).then((r) => r.status);
```

**Expect** `403` with "You can only raise a request for yourself."

**New-hire exception:** sign in as Grace → New request. The "Requesting for a new hire" card with
"Raise on their behalf" appears only for administrators. The seeded example is Somtochukwu Ibe's
laptop and monitor (he has never signed in).

---

## 2. Return for editing, edit, resubmit

**Sign in as** Ibrahim Musa (Zainab's first reviewer) → **Purchase Request** (or open the request from
Requests).

- The row is labelled "Reporting-line review" and the request page offers **Return for editing**,
  **Reject** and **Approve and pass on**.
- Choose **Return for editing**. The dialog asks *"What needs to change?"* and requires an answer.
  **Expect** a warning that the requester is notified and the request is not closed.

**Sign in as** Zainab → open the request from Requests.

- Status badge reads *Returned*, with an amber callout titled "This request was returned for editing —
  it is not closed", showing the reason, who returned it and when.
- **Edit request** opens the form pre-filled, with the reason at the top. Change the justification,
  then **Save and resubmit** (or **Save changes** to keep it as a draft return).
- **Expect** status *Under review* again, back with Ibrahim, and the detail page showing *resubmitted*
  in the history alongside the original return.

**Sign in as** Ibrahim → approve and pass on. **Expect** it moves to Emeka (line manager), not straight
to stock. **Sign in as** Emeka → approve. **Expect** *In progress* and the line waiting at the stock
check.

Check the record: on the request page the history shows returned by / returned at / reason / resubmitted.

---

## 3. Group requests

**Sign in as** Emeka Nwosu (line manager) → Requests → **New request**.

- A **Group request** checkbox appears in the "What do you need?" card header — only for line managers.
- Tick it: the quantity box is replaced by per-person allocation for each team member.
  "One request, several people" explains that each person still gets their own asset record.
- Allocate two laptops to two different team members and submit.
- **Expect** a violet "Group request" badge on the request page and in the Requests list, the
  recipients listed per unit, and the request following the normal review workflow (Emeka's own
  request goes to his manager).

**Sign in as** Fatima → Stock Management. The group line shows the recipients; "Release stock" lists
each unit with the person it is for.

---

## 4. Purchase Request queue and configurable approval levels

The section formerly called "Approvals" is now **Purchase Request** in the sidebar.

- **Sign in as** Ibrahim or Emeka: their queue shows reporting-line reviews.
- By default a category's approval level is *Line Manager*, which the reporting-line review has already
  exercised, so it is skipped and the request goes on to stock. To see an approval level:

**Sign in as** Grace → Organisation → **Asset Configuration** → edit the category that holds the laptop
(**Computing Devices** on a fresh database, **IT Equipment** on migrated data) → set *Approval level* to
**Administrator** → Save. Raise a laptop request as Zainab and pass it through Ibrahim and Emeka.

- **Expect** status *Awaiting approval*, and the request in **Grace's** Purchase Request queue with a
  violet chip reading "administrator approval".
- Approve it there. **Expect** status *In progress* and the approval recorded in the request history.
- The same works from a class: clear the category's *Approval level* back to **Inherit from …**, then set the
  **IT Equipment** class's *Default approval level* to **Administrator**. The category and every type under it
  inherit it. Set it back to *No extra approval* afterwards.

Rejecting and returning behave the same at an approval level as in the reporting line.

---

## 5. Asset Configuration — classes, categories, types and fields

**Sign in as** Grace → Organisation → **Asset Configuration**.

- **Asset classes** at the top: IT Equipment, Office Equipment, Furniture, Facilities Equipment and Vehicles,
  each with its category count, type count, registered asset count and default approval/request rules.
- **Asset categories** sit inside a class (IT Equipment → Computing Devices and Networking Equipment;
  Furniture → Office Seating and Desks and Tables; Facilities Equipment → Air Conditioning). On migrated
  data the original category names are kept and mapped to the closest class.
- **Asset types** sit inside a category (Computing Devices → Dell Latitude laptop, HP monitor, Cisco IP phone;
  Office Seating → Herman Miller chair). Eight types show the fields each one captures.
- **New class / New category / New asset type**: a category cannot be created without a class, and a type
  cannot be created without a category. Approval level and "who may request" can be set at any of the three
  levels; leaving either blank inherits from the level above.
- **Inactive, not deleted**: deactivate a class, category or type. It disappears from new requests and asset
  registration but stays readable on existing assets and historical requests.
- **Delete guards**: try deleting a class that still has a category, a category that still has a type, or a
  type used by an asset or request. Each is refused with an explanation.
- **Edit type & fields**: add a field, choose text / number / dropdown / date / yes-no, mark it
  required, order it, remove or retire a retired field. The seeded laptop has Brand, Model, Ownership,
  Processor, RAM, Storage, Warranty; the air conditioner has Brand, Model, Capacity, Ownership,
  Installation location.

**Fields appear only where they belong:** sign in as Fatima → Assets → Register existing asset, or Purchases.
The type picker is grouped by class, so the class and category are visible before choosing a type.
Choose the laptop type and only laptop fields appear; switch to the air conditioner and the fields
change. A required field blocks saving until it is filled.

**Hierarchy restriction (backend, not just UI):**

1. As Grace, edit the **Facilities** category and set "who may request" to **Administrator**.
2. As Zainab, New request → choose "Split Air Conditioner 1.5HP". The option is labelled
   "administrator and above"; submitting is refused with *"Split Air Conditioner 1.5HP can only be
   requested by a administrator or above. Ask your manager to raise it for you."*
3. The same call straight to the API returns `403`, so the restriction is not just a hidden option.
4. Set the category back to no restriction when finished.

---

## 6. Priority rules

- On the form, Medium is preselected and each level explains when to use it.
- Choosing **High** or **Critical** reveals *Why this priority?* and *What is the business impact?*,
  both required.
- Reviewer escalation: open any request, **Approve and pass on**, change the priority to High and try to
  submit. **Expect** a warning that the higher priority needs both fields, and a refusal until they are
  filled. The raised priority is recorded in the history.
- Ordering: Priority then earliest-raised is used in Stock Management, Quotations and Purchase Request.

---

## 7. Stock release authorisation, handover and returns

**Sign in as** Fatima Bello → **Stock Management**.

1. Open **Release stock** on a line with available assets.
2. Pick an asset for the unit, leave *Authorised by* empty and press **Confirm release**. **Expect**
   "Name the person who authorised this release."
3. Choose **Fatima Bello** as the authoriser. **Expect** "A release must be authorised by someone other
   than the person issuing it."
4. Choose **Grace Okafor**. **Expect** success, and the toast reminding you the handover is recorded
   separately.
5. The **Issued assets that have not yet been handed over or collected** card now lists the asset with
   **Handed over** and **Collected** buttons. Press **Collected**.
6. Open the asset (Assets → the asset): the **Releases** card shows the authoriser, issuer, recipient,
   dates and handover state, and the lifecycle label reads *Collected / in use* rather than *Issued*.

Issuing is therefore never the same as collecting. Also check **Transfers & Returns**: a returned
asset is confirmed by the stock manager, goes back to *Available in stock*, keeps its previous holder
in history, and is never re-issued automatically — the next release records a fresh authorisation.

**Settings → Stock release authorisation** switches between "Required" (default) and "Not required".
Even when optional, the release still records issuer, authoriser, recipient and date.

---

## 8. Purchase recording, photos and the Asset Register

**Sign in as** Fatima → **Purchases** → record a purchase against an approved request (Ifeoma's laptop
is seeded as purchased and ready to issue). Record vendor, cost and receipt, then register each unit:

- Per-unit serial number and photo (upload a file or, on a phone, take a picture). PNG/JPEG/WebP only,
  5 MB limit — try a PDF or a large file and confirm it is refused.
- Type-specific attributes are captured for each unit.

**Asset Register:** Assets shows a photo thumbnail column; open an asset to see the photo card (click to
view full size), the full details, the type-specific fields, purchase information, the releases card and
the complete history. **Edit details** allows correcting the photo and attributes (buttons: Save details).

The purchase → stock → issue chain is unchanged: recording the purchase adds the individual assets to
stock, and they leave through the authorised release and handover above.

---

## 9. Email notifications

Email is configured on the server only — there is nothing to set in the browser.

```bash
MAIL_FROM="I4nnova <Assets@i4nnova.com>"
RESEND_API_KEY=...            # or MAIL_WEBHOOK_URL + optional MAIL_WEBHOOK_TOKEN
APP_URL=http://127.0.0.1:5173
```

Without a provider, every notice is written to `email_log` with status `skipped` and logged as
`[mail:skipped] REQ-… — request submitted → …` in the server console. With a provider configured, the
same actions send mail and the row reads `sent`.

To check triggers and dedupe: submit a request and watch for "request submitted" (to the requester),
"request waiting for your review" (to the reviewer), then return, resubmit, approve, issue, collect and
return an asset. Repeating an action (for example, opening the same page twice) must not send the same
notice twice. Point `RESEND_API_KEY` at an invalid key and confirm the request still succeeds while the
row is marked `failed` — email never breaks the transaction.

---

## 10. Charts, labels and wording

- **Dashboard:** the asset-status donut and the requests-over-time area use different colours per
  series; status colours match the badges used elsewhere. Labels, legends and values are readable.
- **Sidebar:** "Purchase Request" and "Asset Configuration" replace "Approvals" and "Asset Types"
  (`/asset-types` redirects to `/asset-configuration`).
- Skim Requests, Request detail, Purchase Request, Stock Management, Assets, Purchases, Settings and the
  request/edit forms for wording: titles, buttons, helper text, empty states, success and error messages.

---

## 11. Regression — existing Release 1 behaviour

| Check | Where | Expect |
| --- | --- | --- |
| Quotation scoring and recommendation | Quotations → Halima Sani's laptop | Three quotes, recommendation shown, choosing against it demands a reason |
| Financial decision | Financial Approvals as Ngozi | Approve / decline / defer per line; declined items close |
| Partial stock and shortfall | Stock Management → Zainab's five laptops | 3 issued, 2 await quotation, quantities stay accurate |
| Over-budget warning | Purchases → server-room switch | Approved ₦620,000 vs cost ₦705,000 flagged |
| Disposal | Disposal | Pending, approved, completed and rejected examples still listed |
| Staff departure | Staff → a staff member | Blocked by reports, held assets or pending reviews |
| Transfers and returns | Transfers & Returns | Stock manager confirms; history intact |
| Permissions | Open `/settings` or `/asset-configuration` as Zainab | "You do not have access to this module", and the API returns 403 |
| Dark mode | Profile menu → Theme | Light / Dark / System all readable, badges and charts included |
| Mobile | Narrow the window to ~390 px | Sidebar collapses to the menu button, tables scroll, forms stack |

---

## 12. Known gaps and decisions to confirm

- **No email provider is configured** in the demo, so notices are recorded as `skipped` until
  `RESEND_API_KEY` or `MAIL_WEBHOOK_URL` is set.
- **Category approval defaults:** all four seeded categories use line-manager approval, which the
  reporting-line review normally satisfies, so no extra stage appears by default. Change a category's
  level to see it (section 4).
- **Restrictions are opt-in:** no category is restricted out of the box. Facilities/air conditioners can
  be limited to a minimum role in one edit (section 5).
- **Who may authorise a release** is currently stock manager, administrator, line manager or financial
  executive, and never the issuer. Confirm this is the business rule.
- **Group requests** do not require each recipient to acknowledge their allocation.
- **Disposal approver independence** (proposer ≠ approver) remains unenforced, as in Release 1.
- Release 1 exclusions stand: no purchase orders, funds release, goods-received checks, depreciation,
  barcode/QR or maintenance.
