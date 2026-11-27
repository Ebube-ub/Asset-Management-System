import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { one, query } from './db/index.js';
import { ApiError, asyncHandler, parseBody } from './lib/http.js';
import {
  createSession,
  destroySession,
  hashPassword,
  loadUser,
  requireAuth,
  requireRoles,
  verifyPassword,
  SESSION_COOKIE,
} from './lib/auth.js';
import { activeWeights, getSettings, setSetting, uid } from './lib/repo.js';
import {
  approvalsQueue,
  createRequest,
  createRequestSchema,
  editRequestSchema,
  getRequest,
  listRequests,
  resubmitRequest,
  reviewRequest,
  reviewSchema,
  updateReturnedRequest,
} from './domains/requests.js';
import {
  closeItem,
  issueItems,
  requoteItem,
  sendToQuotations,
  stockLevels,
  stockQueue,
  stockSummary,
} from './domains/stock.js';
import { addQuote, chooseQuote, quotationDetail, quotationQueue, quoteSchema } from './domains/quotes.js';
import { decide, financePending } from './domains/finance.js';
import { awaitingPurchase, purchaseList, purchaseSchema, recordPurchase } from './domains/purchases.js';
import {
  assetTypesList,
  assignAsset,
  confirmHandover,
  confirmMovement,
  getAsset,
  listAssets,
  movementSchema,
  movements,
  registerAsset,
  registerAssetSchema,
  requestMovement,
  updateAsset,
  updateAssetSchema,
} from './domains/assets.js';
import {
  configurationOverview,
  createAssetTypeRecord,
  createCategory,
  updateAssetTypeRecord,
  updateCategory,
} from './domains/assetconfig.js';
import {
  completeDisposal,
  decideDisposal,
  disposalList,
  proposeDisposal,
  proposeSchema,
} from './domains/disposals.js';
import {
  createRoom,
  createStaff,
  organisationOverview,
  markLeft,
  resetPassword,
  rooms,
  staffDetail,
  staffDirectory,
  updateRoom,
  updateStaff,
} from './domains/organisation.js';
import { dashboard } from './domains/dashboard.js';
import { markNotificationsRead, notificationFeed } from './domains/notifications.js';
import { runReport, reportsIndex } from './domains/reports.js';
import { ALL_ROLES } from '../shared/domain.js';

export const api = Router();

// ------------------------------------------------------------------
// Authentication
// ------------------------------------------------------------------
api.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({ email: z.string().trim().email('Enter a valid email address.'), password: z.string().min(1, 'Enter your password.') }),
      req.body,
    );
    const staff = await one<{ id: string; password_hash: string; left_at: string | null; name: string }>(
      `select id, password_hash, left_at, name from staff where lower(email) = lower($1)`,
      [input.email],
    );
    if (!staff || !verifyPassword(input.password, staff.password_hash)) {
      throw new ApiError(401, 'That email and password combination is not recognised.');
    }
    if (staff.left_at) {
      throw new ApiError(403, 'This account has been closed because the staff member has left the organisation.');
    }
    const session = await createSession(staff.id);
    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: session.expires,
      path: '/',
    });
    const user = await loadUser(staff.id);
    res.json({ user });
  }),
);

api.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    if (req.sessionId) await destroySession(req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

api.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    res.json({ user: req.user ?? null });
  }),
);

// ------------------------------------------------------------------
// Reference data used to populate forms
// ------------------------------------------------------------------
api.get(
  '/meta',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const roomsList = await query(`select id, name, building, floor from room where active = true order by name`);
    const types = await query<Record<string, unknown>>(
      `select t.id, t.name, t.custody_kind as "custodyKind", t.category,
              t.category_id as "categoryId", c.approval_role as "approvalRole",
              c.min_request_role as "minRequestRole"
         from asset_type t left join asset_category c on c.id = t.category_id
        where t.active = true order by t.name`,
    );
    const fields = await query<Record<string, unknown>>(
      `select id, asset_type_id as "assetTypeId", key, label, field_type as "fieldType", options,
              required, position
         from asset_attribute where active = true order by position, label`,
    );
    const categories = await query(
      `select id, name, approval_role as "approvalRole", min_request_role as "minRequestRole"
         from asset_category where active = true order by name`,
    );
    const staff = await query(
      `select id, name, email, job_title as "jobTitle", manager_id as "managerId", first_signed_in_at as "firstSignedInAt"
         from staff where left_at is null order by name`,
    );
    const vendors = await query<{ vendor_name: string }>(
      `select distinct vendor_name from quote order by vendor_name`,
    );
    const isSecond = settings.secondApproverId === req.user!.id;
    res.json({
      rooms: roomsList,
      assetTypes: types.map((t) => ({
        ...t,
        fields: fields.filter((f) => f.assetTypeId === t.id),
      })),
      assetCategories: categories,
      staff,
      vendors: vendors.map((v) => v.vendor_name),
      settings: {
        parkedReviewDays: settings.parkedReviewDays,
        weights: settings.weights,
        secondApproverName: settings.secondApproverName,
        stockReleaseAuthorization: settings.stockReleaseAuthorization,
      },
      roles: ALL_ROLES,
      isSecondApprover: isSecond,
    });
  }),
);

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
api.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await dashboard(req.user!));
  }),
);

// ------------------------------------------------------------------
// Notification feed
// ------------------------------------------------------------------
api.get(
  '/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await notificationFeed(req.user!));
  }),
);

api.post(
  '/notifications/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await markNotificationsRead(req.user!));
  }),
);

// ------------------------------------------------------------------
// Requests and review
// ------------------------------------------------------------------
api.get(
  '/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(
      await listRequests(req.user!, {
        q: req.query.q as string | undefined,
        status: req.query.status as string | undefined,
        priority: req.query.priority as string | undefined,
        scope: req.query.scope as 'mine' | 'all' | 'team' | undefined,
        page: Number(req.query.page ?? 1),
        pageSize: Number(req.query.pageSize ?? 10),
        sort: req.query.sort as string | undefined,
        dir: req.query.dir as 'asc' | 'desc' | undefined,
      }),
    );
  }),
);

api.post(
  '/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(createRequestSchema, req.body);
    if (input.raisedForId && input.raisedForId !== req.user!.id && !req.user!.roles.includes('administrator')) {
      throw new ApiError(403, 'You can only raise a request for yourself.');
    }
    res.status(201).json(await createRequest(req.user!, input));
  }),
);

api.get(
  '/requests/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getRequest(req.user!, req.params.id));
  }),
);

api.post(
  '/requests/:id/review',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(reviewSchema, req.body);
    res.json(await reviewRequest(req.user!, req.params.id, input));
  }),
);

// The requester edits a returned request, then resubmits it into the workflow.
api.patch(
  '/requests/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(editRequestSchema, req.body);
    res.json(await updateReturnedRequest(req.user!, req.params.id, input));
  }),
);

api.post(
  '/requests/:id/resubmit',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await resubmitRequest(req.user!, req.params.id));
  }),
);

api.get(
  '/approvals',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await approvalsQueue(req.user!));
  }),
);

// ------------------------------------------------------------------
// Stock management
// ------------------------------------------------------------------
api.get(
  '/stock',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (_req, res) => {
    res.json({ ...(await stockQueue()), summary: await stockSummary(), levels: (await stockLevels()).rows });
  }),
);

api.post(
  '/stock/lines/:lineId/issue',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await issueItems(req.user!, req.params.lineId, req.body));
  }),
);

api.post(
  '/stock/lines/:lineId/quotations',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ itemIds: z.array(z.string().uuid()).optional() }), req.body ?? {});
    res.json(await sendToQuotations(req.user!, req.params.lineId, body.itemIds));
  }),
);

api.post(
  '/stock/items/:itemId/close',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await closeItem(req.user!, req.params.itemId, req.body));
  }),
);

api.post(
  '/stock/items/:itemId/requote',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await requoteItem(req.user!, req.params.itemId));
  }),
);

// ------------------------------------------------------------------
// Quotations
// ------------------------------------------------------------------
api.get(
  '/quotations',
  requireRoles('stock_manager', 'financial_executive', 'administrator'),
  asyncHandler(async (_req, res) => {
    res.json(await quotationQueue());
  }),
);

api.get(
  '/quotations/lines/:lineId',
  requireRoles('stock_manager', 'financial_executive', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await quotationDetail(req.params.lineId));
  }),
);

api.post(
  '/quotations/lines/:lineId/quotes',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(quoteSchema, req.body);
    res.status(201).json(await addQuote(req.user!, req.params.lineId, input));
  }),
);

api.post(
  '/quotations/lines/:lineId/choose',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await chooseQuote(req.user!, req.params.lineId, req.body));
  }),
);

// ------------------------------------------------------------------
// Financial approvals
// ------------------------------------------------------------------
api.get(
  '/financial',
  requireRoles('financial_executive', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await financePending(req.user!));
  }),
);

api.post(
  '/financial/lines/:lineId/decision',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await decide(req.user!, req.params.lineId, req.body));
  }),
);

// ------------------------------------------------------------------
// Purchases
// ------------------------------------------------------------------
api.get(
  '/purchases',
  requireRoles('stock_manager', 'financial_executive', 'administrator'),
  asyncHandler(async (_req, res) => {
    res.json({ ...(await purchaseList()), awaiting: await awaitingPurchase() });
  }),
);

api.post(
  '/purchases',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(purchaseSchema, req.body);
    res.status(201).json(await recordPurchase(req.user!, input));
  }),
);

// ------------------------------------------------------------------
// Assets
// ------------------------------------------------------------------
api.get(
  '/assets',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(
      await listAssets(req.user!, {
        q: req.query.q as string | undefined,
        status: req.query.status as string | undefined,
        assetTypeId: req.query.assetTypeId as string | undefined,
        holderId: req.query.holderId as string | undefined,
        roomId: req.query.roomId as string | undefined,
        scope: req.query.scope as 'all' | 'mine' | undefined,
        page: Number(req.query.page ?? 1),
        pageSize: Number(req.query.pageSize ?? 10),
        sort: req.query.sort as string | undefined,
        dir: req.query.dir as 'asc' | 'desc' | undefined,
      }),
    );
  }),
);

api.get(
  '/assets/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getAsset(req.params.id));
  }),
);

api.post(
  '/assets',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(registerAssetSchema, req.body);
    res.status(201).json(await registerAsset(req.user!, input));
  }),
);

api.patch(
  '/assets/:id',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(updateAssetSchema, req.body);
    res.json(await updateAsset(req.user!, req.params.id, input));
  }),
);

api.post(
  '/assets/:id/assign',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(movementSchema, req.body);
    res.json(await assignAsset(req.user!, req.params.id, input));
  }),
);

// Record that an issued asset was physically handed over or collected.
api.post(
  '/assets/:id/handover',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await confirmHandover(req.user!, req.params.id, req.body));
  }),
);

api.post(
  '/assets/:id/transfer',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await requestMovement(req.user!, req.params.id, 'transfer', req.body));
  }),
);

api.post(
  '/assets/:id/return',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await requestMovement(req.user!, req.params.id, 'return', req.body));
  }),
);

api.get(
  '/movements',
  requireAuth,
  asyncHandler(async (req, res) => {
    const kind = (req.query.kind as 'transfer' | 'return' | 'all' | undefined) ?? 'all';
    res.json(await movements(req.user!, kind));
  }),
);

api.post(
  '/movements/:id/confirm',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await confirmMovement(req.user!, req.params.id, 'confirm'));
  }),
);

api.post(
  '/movements/:id/reject',
  requireRoles('stock_manager', 'administrator'),
  asyncHandler(async (req, res) => {
    res.json(await confirmMovement(req.user!, req.params.id, 'reject'));
  }),
);

// ------------------------------------------------------------------
// Disposals
// ------------------------------------------------------------------
api.get(
  '/disposals',
  requireRoles('administrator', 'stock_manager'),
  asyncHandler(async (_req, res) => {
    res.json(await disposalList());
  }),
);

api.post(
  '/disposals',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(proposeSchema, req.body);
    res.status(201).json(await proposeDisposal(req.user!, input));
  }),
);

api.post(
  '/disposals/:id/decide',
  requireRoles('stock_manager'),
  asyncHandler(async (req, res) => {
    res.json(await decideDisposal(req.user!, req.params.id, req.body));
  }),
);

api.post(
  '/disposals/:id/complete',
  requireRoles('administrator', 'stock_manager'),
  asyncHandler(async (req, res) => {
    res.json(await completeDisposal(req.user!, req.params.id, req.body));
  }),
);

// ------------------------------------------------------------------
// Staff, organisation, rooms, asset types
// ------------------------------------------------------------------
api.get(
  '/staff',
  requireRoles('administrator'),
  asyncHandler(async (_req, res) => {
    res.json(await staffDirectory());
  }),
);

api.get(
  '/staff/:id',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await staffDetail(req.params.id));
  }),
);

api.post(
  '/staff',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createStaff(req.user!, req.body));
  }),
);

api.patch(
  '/staff/:id',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await updateStaff(req.user!, req.params.id, req.body));
  }),
);

api.post(
  '/staff/:id/password',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await resetPassword(req.params.id, req.body));
  }),
);

api.post(
  '/staff/:id/leave',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await markLeft(req.user!, req.params.id));
  }),
);

api.get(
  '/organisation',
  requireRoles('administrator'),
  asyncHandler(async (_req, res) => {
    res.json(await organisationOverview());
  }),
);

api.get(
  '/rooms',
  requireRoles('administrator', 'stock_manager'),
  asyncHandler(async (_req, res) => {
    res.json(await rooms());
  }),
);

api.post(
  '/rooms',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createRoom(req.body));
  }),
);

api.patch(
  '/rooms/:id',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await updateRoom(req.params.id, req.body));
  }),
);

api.get(
  '/asset-types',
  requireRoles('administrator', 'stock_manager'),
  asyncHandler(async (req, res) => {
    res.json(await assetTypesList(req.query.includeInactive === 'true'));
  }),
);

// ------------------------------------------------------------------
// Asset Configuration: categories, types, fields and approval level
// ------------------------------------------------------------------
api.get(
  '/asset-configuration',
  requireRoles('administrator', 'stock_manager'),
  asyncHandler(async (_req, res) => {
    res.json(await configurationOverview());
  }),
);

api.post(
  '/asset-categories',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createCategory(req.body));
  }),
);

api.patch(
  '/asset-categories/:id',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await updateCategory(req.params.id, req.body));
  }),
);

api.post(
  '/asset-types',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createAssetTypeRecord(req.body));
  }),
);

api.patch(
  '/asset-types/:id',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    res.json(await updateAssetTypeRecord(req.params.id, req.body));
  }),
);

// ------------------------------------------------------------------
// Reports
// ------------------------------------------------------------------
api.get(
  '/reports',
  requireRoles('administrator', 'stock_manager', 'financial_executive', 'line_manager'),
  asyncHandler(async (_req, res) => {
    res.json(await reportsIndex());
  }),
);

api.get(
  '/reports/:key',
  requireRoles('administrator', 'stock_manager', 'financial_executive', 'line_manager'),
  asyncHandler(async (req, res) => {
    res.json(await runReport(req.params.key));
  }),
);

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------
api.get(
  '/settings',
  requireRoles('administrator'),
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    const history = await query(
      `select w.id, w.price, w.quality, w.delivery, w.warranty, w.effective_from as "effectiveFrom",
              s.name as "setByName"
         from scoring_weights w left join staff s on s.id = w.set_by
        order by w.effective_from desc limit 10`,
    );
    const approvers = await query(
      `select id, name, email, job_title as "jobTitle" from staff where left_at is null order by name`,
    );
    res.json({ ...settings, weightsHistory: history, staff: approvers });
  }),
);

api.put(
  '/settings',
  requireRoles('administrator'),
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({
        weights: z
          .object({
            price: z.coerce.number().min(0).max(100),
            quality: z.coerce.number().min(0).max(100),
            delivery: z.coerce.number().min(0).max(100),
            warranty: z.coerce.number().min(0).max(100),
          })
          .optional(),
        parkedReviewDays: z.coerce.number().int().min(1).max(90).optional(),
        secondApproverId: z.string().uuid().nullable().optional(),
        stockReleaseAuthorization: z.enum(['required', 'not_required']).optional(),
      }),
      req.body,
    );

    if (input.weights) {
      const total =
        input.weights.price + input.weights.quality + input.weights.delivery + input.weights.warranty;
      if (total !== 100) throw new ApiError(400, `The weights must total 100% — they currently total ${total}%.`);
      const current = await activeWeights();
      const changed =
        current.price !== input.weights.price ||
        current.quality !== input.weights.quality ||
        current.delivery !== input.weights.delivery ||
        current.warranty !== input.weights.warranty;
      if (changed) {
        await query(`update scoring_weights set is_active = false where is_active = true`);
        await query(
          `insert into scoring_weights (id, price, quality, delivery, warranty, set_by, is_active)
           values ($1,$2,$3,$4,$5,$6,true)`,
          [
            uid(),
            input.weights.price,
            input.weights.quality,
            input.weights.delivery,
            input.weights.warranty,
            req.user!.id,
          ],
        );
      }
    }
    if (input.parkedReviewDays !== undefined) {
      await setSetting('parked_review_days', String(input.parkedReviewDays));
    }
    if (input.stockReleaseAuthorization !== undefined) {
      await setSetting('stock_release_authorization', input.stockReleaseAuthorization);
    }
    if (input.secondApproverId !== undefined) {
      if (input.secondApproverId === req.user!.id) {
        throw new ApiError(400, 'Choose someone other than yourself as the second approver.');
      }
      if (input.secondApproverId) {
        const approver = await one<{ id: string; name: string }>(
          `select id, name from staff where id = $1 and left_at is null`,
          [input.secondApproverId],
        );
        if (!approver) throw new ApiError(400, 'Choose a valid second approver.');
      }
      await setSetting('second_approver_id', input.secondApproverId ?? '');
    }
    res.json({ ok: true, settings: await getSettings() });
  }),
);

// ------------------------------------------------------------------
// Profile
// ------------------------------------------------------------------
api.get(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const requests = await query<Record<string, unknown>>(
      `select r.id, r.ref, r.status, r.priority, r.raised_at as "raisedAt"
         from request r where r.raised_by = $1 or r.raised_for = $1 order by r.raised_at desc limit 30`,
      [req.user!.id],
    );
    const assets = await query(
      `select a.id, a.ref, at.name as "assetTypeName", a.status, a.serial_number as "serialNumber"
         from asset a join asset_type at on at.id = a.asset_type_id
        where a.holder_staff_id = $1 order by at.name`,
      [req.user!.id],
    );
    const me = await one<Record<string, unknown>>(
      `select s.id, s.name, s.email, s.job_title as "jobTitle", s.first_signed_in_at as "firstSignedInAt",
              m.name as "managerName"
         from staff s left join staff m on m.id = s.manager_id where s.id = $1`,
      [req.user!.id],
    );
    res.json({ user: req.user, staff: me, requests, assets });
  }),
);

api.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({
        name: z.string().trim().min(2).optional(),
        jobTitle: z.string().trim().max(120).nullable().optional(),
      }),
      req.body,
    );
    if (input.name) await query(`update staff set name = $2 where id = $1`, [req.user!.id, input.name]);
    if (input.jobTitle !== undefined)
      await query(`update staff set job_title = $2 where id = $1`, [req.user!.id, input.jobTitle]);
    res.json({ ok: true, user: await loadUser(req.user!.id) });
  }),
);

api.post(
  '/profile/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(
      z.object({
        currentPassword: z.string().min(1, 'Enter your current password.'),
        newPassword: z.string().min(8, 'The new password must be at least 8 characters.'),
      }),
      req.body,
    );
    const row = await one<{ password_hash: string }>(`select password_hash from staff where id = $1`, [
      req.user!.id,
    ]);
    if (!row || !verifyPassword(input.currentPassword, row.password_hash)) {
      throw new ApiError(400, 'Your current password is not correct.');
    }
    await query(`update staff set password_hash = $2 where id = $1`, [
      req.user!.id,
      hashPassword(input.newPassword),
    ]);
    res.json({ ok: true });
  }),
);

// ------------------------------------------------------------------
// Document uploads (quotation and receipt documents)
// ------------------------------------------------------------------
const uploadDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(application\/pdf|image\/png|image\/jpeg|image\/webp|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;
    if (!allowed.test(file.mimetype)) {
      return cb(new ApiError(400, 'Upload a PDF, image, Word or Excel document.'));
    }
    cb(null, true);
  },
});

api.post(
  '/uploads',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'Choose a file to upload.');
    const id = uid();
    const url = `/uploads/${req.file.filename}`;
    await query(
      `insert into document (id, name, url, mime, size, uploaded_by) values ($1,$2,$3,$4,$5,$6)`,
      [id, req.file.originalname, url, req.file.mimetype, req.file.size, req.user!.id],
    );
    res.status(201).json({ id, url, name: req.file.originalname, size: req.file.size });
  }),
);

// ------------------------------------------------------------------
export const weightsEndpoint = asyncHandler(async (_req, res) => {
  res.json({ weights: await activeWeights() });
});
