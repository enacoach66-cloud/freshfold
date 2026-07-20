import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const env = process.env;
const supabase = () => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ALLOWED_EVENTS = new Set(["autosaved", "saved", "finalised", "print_initiated", "print_dialog_closed", "pdf_generated", "whatsapp_shared", "revised", "payment_recorded", "payment_reversed", "voided", "imported"]);
const PAYMENT_METHODS = new Set(["cash", "mpesa", "bank", "card", "other"]);

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(res, 503, { error: "Backend is not configured." });
  try {
    if (!["GET", "HEAD"].includes(req.method) && env.ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== env.ALLOWED_ORIGIN) throw forbidden("Request origin is not allowed.");
    const path = routePath(req);
    if (path === "config" && req.method === "GET") return json(res, 200, { supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY, timezone: env.APP_TIMEZONE || "Africa/Nairobi" });
    if (path === "health" && req.method === "GET") return json(res, 200, { ok: true });
    if (path === "quotes" && req.method === "POST") return createQuote(req, res);
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "quotes" && parts[1]) return quoteRoute(req, res, parts);
    if (parts[0] === "admin") return adminRoute(req, res, parts.slice(1));
    return json(res, 404, { error: "Endpoint not found." });
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { error: error.publicMessage || "An unexpected server error occurred." });
  }
}

async function createQuote(req, res) {
  const payload = validateQuote(req.body);
  const db = supabase();
  const id = validUuid(req.body?.id) ? req.body.id : crypto.randomUUID();
  const writeToken = /^[a-f0-9]{64}$/i.test(req.body?.writeToken || "") ? req.body.writeToken : crypto.randomBytes(32).toString("hex");
  const auth = await optionalUser(req, db);
  const quoteNumber = cleanText(payload.quoteNumber, 80) || await nextQuoteNumber(db);
  const record = quoteRecord(id, quoteNumber, payload, auth?.id || null, hash(writeToken));
  const { data, error } = await db.from("quotations").insert(record).select().single();
  if (error?.code === "23505" && req.body?.id) return updateQuoteByToken(req, res, id);
  if (error) throw dbError(error);
  await replaceItems(db, id, payload.items);
  await addEvent(db, id, "created", auth, { source: auth ? "authenticated" : "public" });
  return json(res, 201, { quotation: publicQuote(data), writeToken });
}

async function quoteRoute(req, res, parts) {
  const id = parts[1], action = parts[2];
  if (!validUuid(id)) throw badRequest("Invalid quotation ID.");
  if (!action && req.method === "GET") return getQuote(req, res, id);
  if (!action && req.method === "PUT") return updateQuoteByToken(req, res, id);
  if (action === "finalise" && req.method === "POST") return finaliseQuote(req, res, id);
  if (action === "events" && req.method === "POST") return recordEvent(req, res, id);
  if (action === "payments" && req.method === "POST" && !parts[3]) return recordPayment(req, res, id);
  if (action === "payments" && parts[3] && parts[4] === "reverse" && req.method === "POST") return reversePayment(req, res, id, parts[3]);
  if (action === "revise" && req.method === "POST") return reviseQuote(req, res, id);
  if (action === "void" && req.method === "POST") return voidQuote(req, res, id);
  return json(res, 404, { error: "Quote endpoint not found." });
}

async function getQuote(req, res, id) {
  const db = supabase(); await requireOwner(req, db);
  const { data, error } = await db.from("quotations").select("*, quotation_items(*), payments(*), quotation_events(*)").eq("id", id).single();
  if (error) throw dbError(error); return json(res, 200, { quotation: data });
}

async function updateQuoteByToken(req, res, id) {
  const db = supabase(); const payload = validateQuote(req.body); const auth = await optionalUser(req, db);
  const { data: current, error } = await db.from("quotations").select("*").eq("id", id).single(); if (error) throw dbError(error);
  const tokenValid = req.headers["x-quote-token"] && safeEqual(current.write_token_hash, hash(req.headers["x-quote-token"]));
  if (!auth && !tokenValid) throw unauthorized();
  if (current.status === "finalised" && !auth) throw forbidden("Finalised quotations require an owner revision.");
  const record = quoteRecord(id, current.quote_number, payload, current.created_by, current.write_token_hash);
  delete record.id; delete record.quote_number; delete record.created_by; delete record.created_at;
  record.amount_paid = Number(current.amount_paid || 0);
  record.balance_due = Math.max(0, money(record.grand_total - record.amount_paid));
  record.payment_status = paymentState(record.amount_paid, record.grand_total);
  const { data, error: updateError } = await db.from("quotations").update(record).eq("id", id).select().single(); if (updateError) throw dbError(updateError);
  await replaceItems(db, id, payload.items); await addEvent(db, id, "autosaved", auth, {});
  return json(res, 200, { quotation: publicQuote(data) });
}

async function finaliseQuote(req, res, id) {
  const db = supabase(); const auth = await optionalUser(req, db); await requireQuoteAccess(req, db, id, auth);
  const { data, error } = await db.from("quotations").update({ status: "finalised", finalised_at: new Date().toISOString() }).eq("id", id).select().single(); if (error) throw dbError(error);
  await addEvent(db, id, "finalised", auth, {}); return json(res, 200, { quotation: publicQuote(data) });
}

async function recordEvent(req, res, id) {
  const type = req.body?.eventType; if (!ALLOWED_EVENTS.has(type)) throw badRequest("Invalid event type.");
  const db = supabase(); const auth = await optionalUser(req, db); await requireQuoteAccess(req, db, id, auth);
  await addEvent(db, id, type, auth, req.body?.metadata || {}); return json(res, 201, { ok: true });
}

async function recordPayment(req, res, id) {
  const db = supabase(); const auth = await requireOperator(req, db); const amount = money(req.body?.amount), method = req.body?.paymentMethod;
  if (amount <= 0 || !PAYMENT_METHODS.has(method)) throw badRequest("A valid amount and payment method are required.");
  if (["mpesa", "bank", "card"].includes(method) && !cleanText(req.body?.paymentReference, 120) && !req.body?.ownerOverride) throw badRequest("A payment reference is required for this method.");
  const payment = { quotation_id: id, amount, payment_method: method, payment_reference: cleanText(req.body?.paymentReference, 120), payment_date: validDate(req.body?.paymentDate) || new Date().toISOString(), received_by: auth.id, notes: cleanText(req.body?.notes, 1000), status: "active" };
  const { data, error } = await db.from("payments").insert(payment).select().single(); if (error) throw dbError(error);
  await refreshPayments(db, id); await addEvent(db, id, "payment_recorded", auth, { paymentId: data.id, amount, method }); await audit(db, "payment", data.id, "recorded", null, data, auth);
  return json(res, 201, { payment: data });
}

async function reversePayment(req, res, id, paymentId) {
  const reason = cleanText(req.body?.reason, 500); if (!reason) throw badRequest("A reversal reason is required.");
  const db = supabase(); const auth = await requireOwner(req, db); const { data: previous, error: findError } = await db.from("payments").select("*").eq("id", paymentId).eq("quotation_id", id).single(); if (findError) throw dbError(findError);
  if (previous.status === "reversed") throw badRequest("Payment is already reversed.");
  const { data, error } = await db.from("payments").update({ status: "reversed", reversed_at: new Date().toISOString(), reversal_reason: reason }).eq("id", paymentId).select().single(); if (error) throw dbError(error);
  await refreshPayments(db, id); await addEvent(db, id, "payment_reversed", auth, { paymentId, reason }); await audit(db, "payment", paymentId, "reversed", previous, data, auth);
  return json(res, 200, { payment: data });
}

async function reviseQuote(req, res, id) {
  const db = supabase(); const auth = await requireOwner(req, db); const { data: previous, error } = await db.from("quotations").select("*").eq("id", id).single(); if (error) throw dbError(error);
  const { data, error: reviseError } = await db.from("quotations").update({ status: "draft", revision_number: previous.revision_number + 1, finalised_at: null }).eq("id", id).select().single(); if (reviseError) throw dbError(reviseError);
  await addEvent(db, id, "revised", auth, { revision: data.revision_number }); await audit(db, "quotation", id, "revised", previous, data, auth); return json(res, 200, { quotation: data });
}

async function voidQuote(req, res, id) {
  const reason = cleanText(req.body?.reason, 500); if (!reason) throw badRequest("A void reason is required.");
  const db = supabase(); const auth = await requireOwner(req, db); const { data: previous, error } = await db.from("quotations").select("*").eq("id", id).single(); if (error) throw dbError(error);
  const { data, error: voidError } = await db.from("quotations").update({ status: "voided", voided_at: new Date().toISOString(), void_reason: reason }).eq("id", id).select().single(); if (voidError) throw dbError(voidError);
  await addEvent(db, id, "voided", auth, { reason }); await audit(db, "quotation", id, "voided", previous, data, auth); return json(res, 200, { quotation: data });
}

async function adminRoute(req, res, parts) {
  const db = supabase(); const auth = await requireOwner(req, db); const resource = parts.join("/");
  if (resource === "dashboard" && req.method === "GET") return dashboard(req, res, db);
  if (resource === "quotations" && req.method === "GET") return listQuotes(req, res, db);
  if (resource.startsWith("quotations/") && req.method === "GET") return getQuote(req, res, parts[1]);
  if (resource === "payments" && req.method === "GET") return listPayments(req, res, db);
  if (resource === "reports/daily" && req.method === "GET") return dailyReport(req, res, db);
  if (resource === "reports/services" && req.method === "GET") return serviceReport(req, res, db);
  if (resource === "audit-logs" && req.method === "GET") return listAudit(req, res, db);
  if (resource === "export" && req.method === "GET") return exportCsv(req, res, db);
  if (resource === "import" && req.method === "POST") return importQuotes(req, res, db, auth);
  return json(res, 404, { error: "Admin endpoint not found." });
}

async function listQuotes(req, res, db) {
  const { from, to } = dateRange(req); const page = clampInt(req.query.page, 1, 100000), limit = clampInt(req.query.limit, 1, 100, 25); let query = db.from("quotations").select("*, quotation_items(count), payments(payment_method,status)", { count: "exact" }).gte("quotation_date", from).lte("quotation_date", to);
  const search = cleanText(req.query.search, 100); if (search) query = query.or(`quote_number.ilike.%${escapeFilter(search)}%,customer_name.ilike.%${escapeFilter(search)}%,customer_phone.ilike.%${escapeFilter(search)}%`);
  if (["unpaid","partially_paid","paid","overpaid"].includes(req.query.paymentStatus)) query = query.eq("payment_status", req.query.paymentStatus);
  if (["draft","finalised","voided"].includes(req.query.status)) query = query.eq("status", req.query.status);
  const sort = ["quotation_date","grand_total","balance_due"].includes(req.query.sort) ? req.query.sort : "created_at"; query = query.order(sort, { ascending: req.query.direction === "asc" }).range((page - 1) * limit, page * limit - 1);
  const { data, error, count } = await query; if (error) throw dbError(error); return json(res, 200, { quotations: data, page, limit, total: count });
}

async function dashboard(req, res, db) {
  const { from, to } = dateRange(req); const { data: quotes, error } = await db.from("quotations").select("id,quotation_date,status,subtotal,discount_amount,delivery_fee,pickup_fee,urgent_service_fee,other_charges,grand_total,amount_paid,balance_due,payment_status").gte("quotation_date", from).lte("quotation_date", to); if (error) throw dbError(error);
  const active = quotes.filter(q => q.status !== "voided"), total = (key) => round(active.reduce((sum, q) => sum + Number(q[key] || 0), 0));
  const { data: payments } = await db.from("payments").select("amount,payment_method,payment_date,status").gte("payment_date", `${from}T00:00:00+03:00`).lte("payment_date", `${to}T23:59:59+03:00`);
  const activePayments = (payments || []).filter(p => p.status === "active"), paid = (method) => round(activePayments.filter(p => !method || p.payment_method === method).reduce((s,p) => s + Number(p.amount), 0));
  const perDay = {}; active.forEach(q => { const d = perDay[q.quotation_date] ||= { date:q.quotation_date, quoted:0, count:0, payments:0 }; d.quoted += Number(q.grand_total); d.count++; }); activePayments.forEach(p => { const date = p.payment_date.slice(0,10); const d = perDay[date] ||= { date, quoted:0, count:0, payments:0 }; d.payments += Number(p.amount); });
  return json(res, 200, { range:{from,to}, summary:{ quotations:quotes.length, active:active.length, voided:quotes.length-active.length, quotedValue:total("grand_total"), averageQuote:active.length ? round(total("grand_total")/active.length):0, discounts:total("discount_amount"), fees:round(total("delivery_fee")+total("pickup_fee")+total("urgent_service_fee")+total("other_charges")), outstanding:total("balance_due"), payments:paid(), cash:paid("cash"), mpesa:paid("mpesa"), bank:paid("bank"), card:paid("card"), other:paid("other") }, charts:{ daily:Object.values(perDay).sort((a,b)=>a.date.localeCompare(b.date)), paymentMethods:["cash","mpesa","bank","card","other"].map(method=>({method,value:paid(method)})), paymentStatus:["paid","partially_paid","unpaid","overpaid"].map(status=>({status,count:active.filter(q=>q.payment_status===status).length})) } });
}

async function listPayments(req, res, db) { const { from,to }=dateRange(req); const {data,error}=await db.from("payments").select("*,quotations(quote_number,customer_name)").gte("payment_date",`${from}T00:00:00+03:00`).lte("payment_date",`${to}T23:59:59+03:00`).order("payment_date",{ascending:false}); if(error)throw dbError(error); return json(res,200,{payments:data}); }
async function dailyReport(req,res,db){ req.query.from=req.query.date||todayNairobi(); req.query.to=req.query.date||todayNairobi(); return dashboard(req,res,db); }
async function serviceReport(req,res,db){ const {from,to}=dateRange(req); const {data,error}=await db.from("quotation_items").select("category,item_name,quantity,line_total,quotations!inner(quotation_date,status)").gte("quotations.quotation_date",from).lte("quotations.quotation_date",to).neq("quotations.status","voided"); if(error)throw dbError(error); const map={}; data.forEach(i=>{const key=`${i.category}|${i.item_name}`,v=map[key]||={category:i.category,item:i.item_name,quantity:0,value:0};v.quantity+=Number(i.quantity);v.value+=Number(i.line_total)}); return json(res,200,{services:Object.values(map).sort((a,b)=>b.value-a.value)}); }
async function listAudit(req,res,db){ const limit=clampInt(req.query.limit,1,200,100); const {data,error}=await db.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(limit); if(error)throw dbError(error); return json(res,200,{auditLogs:data}); }
async function exportCsv(req,res,db){ const {from,to}=dateRange(req); const {data,error}=await db.from("quotations").select("quote_number,quotation_date,customer_name,customer_phone,status,grand_total,amount_paid,balance_due,payment_status").gte("quotation_date",from).lte("quotation_date",to).order("quotation_date"); if(error)throw dbError(error); const headers=Object.keys(data[0]||{quote_number:"",quotation_date:"",customer_name:"",customer_phone:"",status:"",grand_total:"",amount_paid:"",balance_due:"",payment_status:""}); const csv=[headers.join(","),...data.map(row=>headers.map(k=>csvCell(row[k])).join(","))].join("\n"); res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="freshfold-report-${from}-${to}.csv"`);return res.status(200).send(csv); }
async function importQuotes(req,res,db,auth){ const records=Array.isArray(req.body?.quotations)?req.body.quotations:[]; if(!records.length||records.length>500)throw badRequest("Provide between 1 and 500 quotations."); let imported=0,skipped=0; for(const raw of records){try{const payload=validateQuote({...raw,items:raw.rows||raw.items});const number=cleanText(raw.quoteNumber,80);if(!number){skipped++;continue}const {data:exists}=await db.from("quotations").select("id").eq("quote_number",number).maybeSingle();if(exists){skipped++;continue}const id=crypto.randomUUID(),record={...quoteRecord(id,number,payload,auth.id,null),imported_from_local_storage:true};const {error}=await db.from("quotations").insert(record);if(error){skipped++;continue}await replaceItems(db,id,payload.items);await addEvent(db,id,"imported",auth,{source:"localStorage"});await audit(db,"quotation",id,"imported",null,record,auth);imported++}catch{skipped++}}return json(res,200,{imported,skipped});}

function validateQuote(body={}) { const items = Array.isArray(body.items) ? body.items : Array.isArray(body.rows) ? body.rows : []; if (!items.length || items.length > 200) throw badRequest("Quotation must contain 1 to 200 items."); const normalized = items.map((item) => { const quantity = decimal(item.quantity), unitPrice = money(item.unitPrice); if (!cleanText(item.itemName,200) || quantity <= 0 || unitPrice < 0) throw badRequest("Each item requires a name, positive quantity, and valid price."); return { category:cleanText(item.category,120)||"Other", itemName:cleanText(item.itemName,200), unitType:cleanText(item.unitType,40)||"piece", quantity, unitPrice, lineTotal:money(quantity*unitPrice), note:cleanText(item.note||item.itemNote,500) }; }); const subtotal=money(normalized.reduce((s,i)=>s+i.lineTotal,0)),discountType=["none","fixed","percentage"].includes(body.discountType)?body.discountType:"none",discountValue=Math.max(0,money(body.discountValue)),discountAmount=discountType==="percentage"?money(subtotal*Math.min(discountValue,100)/100):discountType==="fixed"?Math.min(discountValue,subtotal):0,fees=body.fees||{},deliveryFee=Math.max(0,money(fees.delivery??body.deliveryFee)),pickupFee=Math.max(0,money(fees.pickup??body.pickupFee)),urgentFee=Math.max(0,money(fees.urgent??body.urgentServiceFee)),otherCharges=Math.max(0,money(body.otherCharges)),grandTotal=money(subtotal-discountAmount+deliveryFee+pickupFee+urgentFee+otherCharges),amountPaid=0,balanceDue=grandTotal,paymentStatus="unpaid"; return { quoteNumber:body.quoteNumber,customer:body.customer||{},quoteDate:validDateOnly(body.quoteDate)||todayNairobi(),notes:cleanText(body.notes,2000),discountType,discountValue,items:normalized,subtotal,discountAmount,deliveryFee,pickupFee,urgentFee,otherCharges,grandTotal,amountPaid,balanceDue,paymentStatus }; }
function quoteRecord(id,quoteNumber,p,createdBy,tokenHash){return{id,quote_number:quoteNumber,customer_name:cleanText(p.customer.name,200),customer_phone:cleanText(p.customer.phone,40),customer_location:cleanText(p.customer.location,300),customer_type:cleanText(p.customer.type,80),quotation_date:p.quoteDate,status:"draft",subtotal:p.subtotal,discount_type:p.discountType,discount_value:p.discountValue,discount_amount:p.discountAmount,delivery_fee:p.deliveryFee,pickup_fee:p.pickupFee,urgent_service_fee:p.urgentFee,other_charges:p.otherCharges,grand_total:p.grandTotal,amount_paid:p.amountPaid,balance_due:p.balanceDue,payment_status:p.paymentStatus,notes:p.notes,created_by:createdBy,write_token_hash:tokenHash};}
async function replaceItems(db,id,items){const {error:deleteError}=await db.from("quotation_items").delete().eq("quotation_id",id);if(deleteError)throw dbError(deleteError);const {error}=await db.from("quotation_items").insert(items.map(i=>({quotation_id:id,category:i.category,item_name:i.itemName,unit_type:i.unitType,quantity:i.quantity,unit_price:i.unitPrice,line_total:i.lineTotal,item_note:i.note})));if(error)throw dbError(error);}
async function refreshPayments(db,id){const {data:q,error:qError}=await db.from("quotations").select("grand_total").eq("id",id).single();if(qError)throw dbError(qError);const {data:p,error:pError}=await db.from("payments").select("amount").eq("quotation_id",id).eq("status","active");if(pError)throw dbError(pError);const paid=money(p.reduce((s,x)=>s+Number(x.amount),0)),total=Number(q.grand_total),status=paymentState(paid,total);const {error}=await db.from("quotations").update({amount_paid:paid,balance_due:Math.max(0,money(total-paid)),payment_status:status}).eq("id",id);if(error)throw dbError(error);}
async function addEvent(db,id,type,auth,metadata){const {error}=await db.from("quotation_events").insert({quotation_id:id,event_type:type,actor_id:auth?.id||null,actor_role:auth?.role||"public",metadata});if(error)throw dbError(error);}
async function audit(db,type,id,action,previous,next,auth){const {error}=await db.from("audit_logs").insert({entity_type:type,entity_id:id,action,previous_values:previous,new_values:next,actor_id:auth.id,actor_role:auth.role});if(error)throw dbError(error);}
async function optionalUser(req,db){const token=bearer(req);if(!token)return null;const {data,error}=await db.auth.getUser(token);if(error||!data.user)return null;const {data:profile}=await db.from("profiles").select("role,email,full_name").eq("id",data.user.id).single();return profile?{id:data.user.id,...profile}:null;}
async function requireOperator(req,db){const user=await optionalUser(req,db);if(!user)throw unauthorized();if(!["owner","operator"].includes(user.role))throw forbidden();return user;}
async function requireOwner(req,db){const user=await optionalUser(req,db);if(!user)throw unauthorized();if(user.role!=="owner"||normalizeEmail(user.email)!==normalizeEmail(env.OWNER_EMAIL))throw forbidden();return user;}
async function requireQuoteAccess(req,db,id,auth){if(auth&&["owner","operator"].includes(auth.role))return;const {data,error}=await db.from("quotations").select("write_token_hash").eq("id",id).single();if(error)throw dbError(error);if(!req.headers["x-quote-token"]||!safeEqual(data.write_token_hash,hash(req.headers["x-quote-token"])))throw unauthorized();}
async function nextQuoteNumber(db){const date=todayNairobi().replaceAll("-","");const prefix=`FF-${date}-`;const {data}=await db.from("quotations").select("quote_number").like("quote_number",`${prefix}%`).order("quote_number",{ascending:false}).limit(1);const last=Number(data?.[0]?.quote_number?.split("-").pop()||0);return `${prefix}${String(last+1).padStart(3,"0")}`;}
function dateRange(req){const today=todayNairobi(),from=validDateOnly(req.query.from)||today,to=validDateOnly(req.query.to)||from;if(from>to)throw badRequest("Start date must not be after end date.");return{from,to};}
function publicQuote(q){const{write_token_hash,...safe}=q;return safe;}
function routePath(req){const p=req.query.path;return(Array.isArray(p)?p.join("/"):p||"").replace(/^\/+|\/+$/g,"");}
function bearer(req){const value=req.headers.authorization||"";return value.startsWith("Bearer ")?value.slice(7):null;}
function hash(value){return crypto.createHash("sha256").update(String(value)).digest("hex");}
function safeEqual(a,b){if(!a||!b||a.length!==b.length)return false;return crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function validUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||"");}
function cleanText(v,max){const text=String(v??"").trim();return text?text.slice(0,max):null;}
function money(v){const n=Number(v||0);if(!Number.isFinite(n))throw badRequest("Invalid money value.");return Math.round(n*100)/100;}
function decimal(v){const n=Number(v);return Number.isFinite(n)?Math.round(n*1000)/1000:0;}
function round(v){return Math.round(v*100)/100;}
function validDateOnly(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||"")?v:null;}
function validDate(v){const source=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v||"")?`${v}:00+03:00`:v,d=new Date(source);return Number.isNaN(d.valueOf())?null:d.toISOString();}
function todayNairobi(){return new Intl.DateTimeFormat("en-CA",{timeZone:env.APP_TIMEZONE||"Africa/Nairobi",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function clampInt(v,min,max,fallback){const n=Number.parseInt(v,10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
function escapeFilter(v){return v.replace(/[%_,()]/g,"");}
function csvCell(v){const text=String(v??"");return `"${text.replaceAll('"','""')}"`;}
function normalizeEmail(v){return String(v||"").trim().toLowerCase();}
function paymentState(paid,total){return paid===0?"unpaid":paid<total?"partially_paid":paid===total?"paid":"overpaid";}
function setSecurityHeaders(res){res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Cache-Control","no-store");}
function json(res,status,body){return res.status(status).json(body);}
function badRequest(message){return Object.assign(new Error(message),{status:400,publicMessage:message});}
function unauthorized(){return Object.assign(new Error("Unauthorized"),{status:401,publicMessage:"Authentication required."});}
function forbidden(message="Owner access is required."){return Object.assign(new Error(message),{status:403,publicMessage:message});}
function dbError(error){return Object.assign(new Error(error.message),{status:error.code==="PGRST116"?404:500,publicMessage:error.code==="PGRST116"?"Record not found.":"Database operation failed."});}
