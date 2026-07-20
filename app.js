(function () {
  "use strict";

  const BUSINESS = Object.freeze({ name: "FreshFold Laundry", tagline: "Fresh. Clean. Delivered.", phone: "0100677971", paymentMethod: "Pochi la Biashara", paymentNumber: "0741179804", terms: "Prices may change after inspection for heavily stained, oversized, or special fabric items." });
  const STORAGE = Object.freeze({ saved: "freshfoldSavedQuotes", draft: "washwaveDraftQuote", counter: "freshfoldQuoteCounter", welcome: "washwaveWelcomeDismissed" });
  const UNITS = ["piece", "kg", "set", "meter"];
  const priceList = (window.FRESHFOLD_PRICE_LIST || window.WASHWAVE_PRICE_LIST || []).filter((g) => g.active !== false);
  const services = priceList.flatMap((g) => g.items.filter((i) => i.active !== false).map((i) => ({ ...i, category: g.category, categoryId: g.id })));
  const state = { quoteNumber: "", rows: [], editingRowId: null, quickFilter: "all", draftReady: false };
  const els = {};
  let draftTimer;

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    bindElements(); populateCategories(); bindEvents(); resetQuote(false); renderQuickAdd(); renderAll(); setupProgress();
    if (localStorage.getItem(STORAGE.welcome) === "1") els.welcome.classList.add("hidden");
    if (localStorage.getItem(STORAGE.draft)) els.recoveryDialog.showModal();
  }

  function bindElements() {
    document.querySelectorAll("[id]").forEach((el) => { els[toCamel(el.id)] = el; });
  }

  function bindEvents() {
    els.serviceCategory.addEventListener("change", () => { els.serviceSearch.value = ""; populateServices(true); validateServiceForm(); scheduleDraft(); });
    els.serviceSearch.addEventListener("input", () => populateServices(false));
    [els.serviceItem, els.quantity, els.unitPrice].forEach((el) => el.addEventListener("input", () => { selectService(); validateServiceForm(); }));
    els.unitType.addEventListener("change", () => toggleUnit(els.unitType, els.customUnitWrap));
    els.customUnitType.addEventListener("change", () => toggleUnit(els.customUnitType, els.customFormUnitWrap));
    els.priceItemForm.addEventListener("submit", addFromForm);
    els.cancelEdit.addEventListener("click", clearServiceForm);
    els.quickSearch.addEventListener("input", renderQuickAdd);
    els.categoryFilters.addEventListener("click", (e) => { const b = e.target.closest("button[data-filter]"); if (!b) return; state.quickFilter = b.dataset.filter; renderQuickAdd(); });
    els.quickAddList.addEventListener("click", (e) => { const b = e.target.closest("button[data-service]"); if (b) quickAdd(b.dataset.service); });
    els.quoteLines.addEventListener("click", handleRowAction);
    els.quoteLines.addEventListener("input", handleRowInput);
    els.showCustom.addEventListener("click", () => els.customDialog.showModal());
    els.customItemForm.addEventListener("submit", addCustom);
    document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
    [els.customerType, els.customerName, els.customerPhone, els.customerLocation, els.quoteDate, els.discountType, els.discountValue, els.deliveryFee, els.pickupFee, els.urgentFee, els.amountPaid, els.quoteNotes].forEach((el) => {
      el.addEventListener("input", onQuoteChange); el.addEventListener("change", onQuoteChange);
    });
    els.customerPhone.addEventListener("blur", validatePhone);
    els.newQuote.addEventListener("click", () => requestNewQuote(true));
    els.saveQuote.addEventListener("click", saveQuote);
    els.previewQuote.addEventListener("click", openPreview); els.mobilePreview.addEventListener("click", openPreview);
    els.printQuote.addEventListener("click", printQuote); els.downloadPdf.addEventListener("click", printQuote); els.previewPrint.addEventListener("click", printQuote);
    els.shareWhatsapp.addEventListener("click", () => prepareWhatsApp());
    els.phoneForm.addEventListener("submit", (e) => { e.preventDefault(); if (validatePhoneValue(els.sharePhone.value)) { els.phoneDialog.close(); openWhatsApp(els.sharePhone.value); } else els.sharePhoneError.textContent = "Enter a valid Kenyan phone number."; });
    els.savedQuotes.addEventListener("click", openSaved); els.savedSearch.addEventListener("input", renderSaved); els.savedDate.addEventListener("input", renderSaved); els.savedList.addEventListener("click", handleSavedAction);
    els.dismissWelcome.addEventListener("click", () => { localStorage.setItem(STORAGE.welcome, "1"); els.welcome.classList.add("hidden"); });
    els.continueDraft.addEventListener("click", recoverDraft); els.discardDraft.addEventListener("click", () => { localStorage.removeItem(STORAGE.draft); els.recoveryDialog.close(); resetQuote(true); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
  }

  function populateCategories() {
    priceList.forEach((g) => els.serviceCategory.add(new Option(g.category, g.id)));
    els.categoryFilters.innerHTML = [{ id: "all", category: "All" }, ...priceList].map((g) => `<button class="filter-button" type="button" data-filter="${escapeHtml(g.id)}">${escapeHtml(g.category)}</button>`).join("");
  }

  function populateServices(moveFocus = false) {
    const query = normalize(els.serviceSearch.value);
    const matches = services.filter((s) => s.categoryId === els.serviceCategory.value && normalize(s.name).includes(query));
    els.serviceItem.innerHTML = '<option value="">Choose a service</option>';
    matches.forEach((s) => els.serviceItem.add(new Option(s.name, s.id)));
    els.serviceSearch.disabled = !els.serviceCategory.value;
    els.serviceItem.disabled = !matches.length;
    if (moveFocus) els.serviceSearch.focus();
    validateServiceForm();
  }

  function selectService() {
    const service = services.find((s) => s.id === els.serviceItem.value); if (!service) return;
    if (!state.editingRowId || els.unitPrice.value === "") els.unitPrice.value = service.defaultPrice ?? "";
    els.unitType.value = UNITS.includes(service.unitType) ? service.unitType : "custom";
    toggleUnit(els.unitType, els.customUnitWrap); updatePriceHint(service);
  }

  function validateServiceForm() {
    const service = services.find((s) => s.id === els.serviceItem.value);
    const valid = service && number(els.quantity.value) > 0 && number(els.unitPrice.value) >= 0 && els.unitPrice.value !== "";
    els.addItemButton.disabled = !valid;
    return Boolean(valid);
  }

  function addFromForm(e) {
    e.preventDefault(); if (!validateServiceForm()) return showError(els.itemFormError, "Select a service and enter a valid quantity and price.");
    const service = services.find((s) => s.id === els.serviceItem.value);
    const row = makeRow(service.name, service.category, readUnit(els.unitType, els.customUnit), number(els.quantity.value), number(els.unitPrice.value), els.itemNote.value, service.id, service.defaultPrice);
    if (state.editingRowId) {
      const index = state.rows.findIndex((r) => r.id === state.editingRowId); row.id = state.editingRowId; state.rows[index] = row; toast(`${row.itemName} updated.`);
    } else addWithDuplicateChoice(row);
    const category = els.serviceCategory.value; clearServiceForm(); els.serviceCategory.value = category; populateServices(); els.serviceItem.focus(); renderAll(); scheduleDraft();
  }

  function addWithDuplicateChoice(row) {
    const existing = state.rows.find((r) => r.serviceId && r.serviceId === row.serviceId && r.unitPrice === row.unitPrice);
    if (existing && window.confirm(`${row.itemName} is already on the quote. Select OK to increase its quantity, or Cancel to add a separate line.`)) existing.quantity += row.quantity;
    else state.rows.push(row);
    toast(`${row.itemName} added to the quote.`);
  }

  function quickAdd(id) {
    const service = services.find((s) => s.id === id); if (!service) return;
    if (service.defaultPrice == null) { els.serviceCategory.value = service.categoryId; els.serviceSearch.value = ""; populateServices(); els.serviceItem.value = service.id; selectService(); els.unitPrice.focus(); toast("Enter the price to add this service."); return; }
    const existing = state.rows.find((r) => r.serviceId === id && r.unitPrice === service.defaultPrice);
    if (existing) existing.quantity += 1; else state.rows.push(makeRow(service.name, service.category, service.unitType, 1, service.defaultPrice, "", service.id, service.defaultPrice));
    toast(`${service.name} added to the quote.`); renderAll(); scheduleDraft();
  }

  function renderQuickAdd() {
    const query = normalize(els.quickSearch.value); const matches = services.filter((s) => (state.quickFilter === "all" || s.categoryId === state.quickFilter) && normalize(`${s.name} ${s.category}`).includes(query));
    document.querySelectorAll("[data-filter]").forEach((b) => { const active = b.dataset.filter === state.quickFilter; b.classList.toggle("active", active); b.setAttribute("aria-pressed", active); });
    els.quickAddList.innerHTML = matches.map((s) => `<button class="quick-button" type="button" data-service="${escapeHtml(s.id)}"><span class="quick-name">${escapeHtml(s.name)}</span><small>${escapeHtml(s.category)} · per ${escapeHtml(s.unitType)}</small><strong>${s.defaultPrice == null ? "Enter price" : money(s.defaultPrice)}</strong><span class="quick-action">+ Add</span></button>`).join("") || '<p class="empty-state">No matching services.</p>';
  }

  function addCustom(e) {
    e.preventDefault(); const name = els.customItemName.value.trim(), category = els.customCategory.value.trim(), qty = number(els.customQuantity.value), price = number(els.customPrice.value);
    if (!name || !category || qty <= 0 || price < 0 || els.customPrice.value === "") return showError(els.customFormError, "Complete the item name, category, quantity, and price.");
    state.rows.push(makeRow(name, category, readUnit(els.customUnitType, els.customFormUnit), qty, price, els.customNote.value));
    toast(`${name} added to the quote.`); els.customItemForm.reset(); els.customQuantity.value = 1; els.customDialog.close(); renderAll(); scheduleDraft();
  }

  function makeRow(itemName, category, unitType, quantity, unitPrice, note, serviceId = null, defaultPrice = null) { return { id: uid(), serviceId, itemName, category, unitType, quantity, unitPrice, defaultPrice, note: note.trim() }; }

  function renderAll() { renderTable(); renderSummary(); renderPreview(); updateActions(); }

  function renderTable() {
    const has = state.rows.length > 0; els.emptyState.classList.toggle("hidden", has); els.quoteTableWrap.classList.toggle("hidden", !has); els.itemCount.textContent = `${state.rows.length} ${state.rows.length === 1 ? "service" : "services"}`;
    els.quoteLines.innerHTML = state.rows.map((r) => `<tr><td data-label="Item"><strong>${escapeHtml(r.itemName)}</strong><small>${escapeHtml(r.category)}${r.note ? ` · ${escapeHtml(r.note)}` : ""}</small></td><td data-label="Unit">${escapeHtml(r.unitType)}</td><td data-label="Quantity"><input class="table-input" data-field="quantity" data-id="${r.id}" type="number" min="0.01" step="0.01" value="${r.quantity}" aria-label="Quantity for ${escapeHtml(r.itemName)}"></td><td data-label="Unit price"><input class="table-input price-input" data-field="unitPrice" data-id="${r.id}" type="number" min="0" step="1" value="${r.unitPrice}" aria-label="Unit price for ${escapeHtml(r.itemName)}">${isCustomPrice(r) ? '<span class="price-label">Custom price</span>' : ""}</td><td data-label="Total"><strong>${money(lineTotal(r))}</strong></td><td data-label="Actions"><div class="row-actions"><button title="Edit" aria-label="Edit ${escapeHtml(r.itemName)}" data-action="edit" data-id="${r.id}">✎</button><button title="Duplicate" aria-label="Duplicate ${escapeHtml(r.itemName)}" data-action="duplicate" data-id="${r.id}">⧉</button><button class="delete-button" title="Delete" aria-label="Delete ${escapeHtml(r.itemName)}" data-action="delete" data-id="${r.id}">×</button></div></td></tr>`).join("");
  }

  function handleRowInput(e) { const row = state.rows.find((r) => r.id === e.target.dataset.id); if (!row) return; const value = number(e.target.value); if (e.target.dataset.field === "quantity" && value > 0) row.quantity = value; if (e.target.dataset.field === "unitPrice" && value >= 0) row.unitPrice = value; renderAll(); scheduleDraft(); }
  function handleRowAction(e) { const b = e.target.closest("button[data-action]"); if (!b) return; const row = state.rows.find((r) => r.id === b.dataset.id); if (!row) return;
    if (b.dataset.action === "delete" && confirm(`Delete ${row.itemName}?`)) { state.rows = state.rows.filter((r) => r.id !== row.id); toast(`${row.itemName} deleted.`); }
    if (b.dataset.action === "duplicate") { state.rows.push({ ...row, id: uid() }); toast(`${row.itemName} duplicated.`); }
    if (b.dataset.action === "edit") loadForEdit(row); renderAll(); scheduleDraft();
  }

  function loadForEdit(row) { const service = services.find((s) => s.id === row.serviceId); if (!service) return toast("Custom items can be edited directly in the table.", true); state.editingRowId = row.id; els.serviceCategory.value = service.categoryId; populateServices(); els.serviceItem.value = service.id; els.quantity.value = row.quantity; els.unitPrice.value = row.unitPrice; els.itemNote.value = row.note; setUnit(row.unitType); els.addItemButton.textContent = "Update service"; els.addItemButton.disabled = false; els.cancelEdit.classList.remove("hidden"); els.priceItemForm.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function clearServiceForm() { state.editingRowId = null; els.serviceItem.value = ""; els.serviceSearch.value = ""; els.quantity.value = 1; els.unitPrice.value = ""; els.itemNote.value = ""; els.unitType.value = "piece"; els.addItemButton.textContent = "Add to Quote"; els.addItemButton.disabled = true; els.cancelEdit.classList.add("hidden"); els.priceHint.textContent = ""; showError(els.itemFormError, ""); }

  function totals() {
    const subtotal = cents(state.rows.reduce((sum, r) => sum + lineTotal(r), 0)); let rawDiscount = Math.max(0, number(els.discountValue.value)); let discount = 0, discountError = "";
    if (els.discountType.value === "percentage") { if (rawDiscount > 100) discountError = "Percentage cannot exceed 100%."; discount = cents(subtotal * Math.min(rawDiscount, 100) / 100); }
    if (els.discountType.value === "fixed") { if (rawDiscount > subtotal) discountError = "Discount cannot exceed the subtotal."; discount = Math.min(rawDiscount, subtotal); }
    const delivery = positive(els.deliveryFee.value), pickup = positive(els.pickupFee.value), urgent = positive(els.urgentFee.value), extraCharges = cents(delivery + pickup + urgent), grandTotal = cents(subtotal - discount + extraCharges), amountPaid = positive(els.amountPaid.value), difference = cents(grandTotal - amountPaid);
    return { subtotal, discount, delivery, pickup, urgent, extraCharges, grandTotal, amountPaid, balanceDue: Math.max(0, difference), changeDue: Math.max(0, -difference), discountError };
  }

  function renderSummary() { const t = totals(); els.discountValueWrap.classList.toggle("hidden", els.discountType.value === "none"); els.discountError.textContent = t.discountError; els.subtotal.textContent = money(t.subtotal); els.discountTotal.textContent = t.discount ? `− ${money(t.discount)}` : money(0); els.deliveryTotal.textContent = money(t.delivery); els.pickupTotal.textContent = money(t.pickup); els.urgentTotal.textContent = money(t.urgent); els.extraCharges.textContent = money(t.extraCharges); els.grandTotal.textContent = money(t.grandTotal); els.mobileGrandTotal.textContent = money(t.grandTotal); const change = t.changeDue > 0; els.balanceLabel.textContent = change ? "Change due" : "Balance due"; els.balanceDue.textContent = money(change ? t.changeDue : t.balanceDue); els.balanceLine.dataset.status = change ? "overpaid" : t.balanceDue === 0 ? "paid" : t.amountPaid > 0 ? "partial" : "unpaid"; }

  function renderPreview() { const t = totals(), c = customer(); const rowHtml = state.rows.length ? state.rows.map((r, i) => `<tr><td>${i + 1}</td><td><strong>${escapeHtml(r.itemName)}</strong><small>${escapeHtml(r.category)}${r.note ? ` · ${escapeHtml(r.note)}` : ""}</small></td><td>${escapeHtml(r.unitType)}</td><td>${quantity(r.quantity)}</td><td>${money(r.unitPrice)}</td><td>${money(lineTotal(r))}</td></tr>`).join("") : '<tr><td colspan="6" class="preview-empty">No services added.</td></tr>';
    const html = `<article class="quotation-sheet"><header class="preview-header"><div><img class="preview-logo-image" src="data/logobg.png" alt="FreshFold Laundry"><p>${BUSINESS.tagline}</p><p>Call / WhatsApp: ${BUSINESS.phone}</p></div><div class="preview-meta"><strong>Quotation</strong><span>${escapeHtml(state.quoteNumber)}</span><small>${displayDate(els.quoteDate.value)}</small></div></header><section class="preview-customer"><div><span>Customer</span><strong>${escapeHtml(c.name || c.type)}</strong></div><div><span>Phone</span><strong>${escapeHtml(c.phone || "Not provided")}</strong></div><div><span>Location</span><strong>${escapeHtml(c.location || "Not provided")}</strong></div></section><table class="preview-table"><thead><tr><th>#</th><th>Service</th><th>Unit</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${rowHtml}</tbody></table><section class="preview-totals"><div><span>Subtotal</span><strong>${money(t.subtotal)}</strong></div><div><span>Discount</span><strong>− ${money(t.discount)}</strong></div><div><span>Extra charges</span><strong>${money(t.extraCharges)}</strong></div><div class="preview-grand"><span>Grand total</span><strong>${money(t.grandTotal)}</strong></div><div><span>Amount paid</span><strong>${money(t.amountPaid)}</strong></div><div><span>${t.changeDue ? "Change due" : "Balance due"}</span><strong>${money(t.changeDue || t.balanceDue)}</strong></div></section>${els.quoteNotes.value.trim() ? `<p class="preview-note">${escapeHtml(els.quoteNotes.value.trim())}</p>` : ""}<section class="payment-details"><span>Payment details</span><strong>${BUSINESS.paymentMethod}</strong><b>${BUSINESS.paymentNumber}</b></section><p class="terms-note">${BUSINESS.terms}</p><p class="thank-you">Thank you for choosing ${BUSINESS.name}.</p></article>`;
    els.quotePreview.innerHTML = html; els.modalPreview.innerHTML = html;
  }

  function openPreview() { renderPreview(); els.previewDialog.showModal(); }
  function printQuote(e) {
    if (!requireRows()) return;
    withLoading(e?.currentTarget, "Preparing…", () => {
      renderPreview();
      const originalTitle = document.title;
      const suggestedFileName = getQuotationFileName();
      document.title = suggestedFileName;
      window.addEventListener("afterprint", () => { document.title = originalTitle; }, { once: true });
      window.print();
      toast(`Print dialog opened. Suggested file name: ${suggestedFileName}.pdf`);
    });
  }
  function updateActions() { document.querySelectorAll(".output-action").forEach((b) => { b.disabled = state.rows.length === 0; }); }

  function saveQuote() { if (!requireRows() || !validatePhone()) return; withLoading(els.saveQuote, "Saving…", () => { const quote = serialize(); const saved = readSaved(); const next = [quote, ...saved.filter((q) => q.quoteNumber !== quote.quoteNumber)]; localStorage.setItem(STORAGE.saved, JSON.stringify(next.slice(0, 100))); localStorage.removeItem(STORAGE.draft); toast(`Quote ${state.quoteNumber} saved.`); }); }
  function serialize() { return { quoteNumber: state.quoteNumber, savedAt: new Date().toISOString(), customer: customer(), quoteDate: els.quoteDate.value, rows: state.rows, totals: totals(), discountType: els.discountType.value, discountValue: positive(els.discountValue.value), fees: { delivery: positive(els.deliveryFee.value), pickup: positive(els.pickupFee.value), urgent: positive(els.urgentFee.value) }, amountPaid: positive(els.amountPaid.value), notes: els.quoteNotes.value.trim() }; }
  function readSaved() { try { const data = JSON.parse(localStorage.getItem(STORAGE.saved) || "[]"); return Array.isArray(data) ? data.map(migrateStoredQuote) : []; } catch { return []; } }

  function migrateStoredQuote(quote) {
    const legacyPrices = { "clothes-per-kg": 60, "sofas-chester-beds": 2000 };
    const rows = (quote.rows || []).filter((row) => row.serviceId !== "hard-carpet").map((row) => {
      const current = services.find((service) => service.id === row.serviceId);
      if (!current) return row;
      const usedLegacyStandard = legacyPrices[row.serviceId] != null && number(row.unitPrice) === legacyPrices[row.serviceId];
      return usedLegacyStandard ? { ...row, unitPrice: current.defaultPrice, defaultPrice: current.defaultPrice } : { ...row, defaultPrice: current.defaultPrice };
    });
    return { ...quote, rows: rows.map((row) => { const current = services.find((service) => service.id === row.serviceId); return current ? { ...row, category: current.category, itemName: current.name, unitType: current.unitType } : row; }) };
  }

  function openSaved() { renderSaved(); els.savedDialog.showModal(); }
  function renderSaved() { const query = normalize(els.savedSearch.value), date = els.savedDate.value; const list = readSaved().filter((q) => (!date || q.quoteDate === date) && normalize(`${q.quoteNumber} ${q.customer?.name || ""} ${q.customer?.phone || ""}`).includes(query)); els.savedList.innerHTML = list.map((q) => { const t = quoteTotals(q), status = t.amountPaid >= t.grandTotal ? "Paid" : t.amountPaid > 0 ? "Partially paid" : "Unpaid", statusClass = normalize(status).replace(/\s+/g, "-"); return `<article class="saved-item"><div><strong>${escapeHtml(q.quoteNumber)}</strong><span>${escapeHtml(q.customer?.name || q.customer?.type || "Walk-in customer")} · ${escapeHtml(displayDate(q.quoteDate))}</span></div><div><span class="status-badge ${statusClass}">${status}</span><strong>${money(t.grandTotal)}</strong></div><div class="saved-actions"><button data-saved-action="open" data-number="${escapeHtml(q.quoteNumber)}">Open</button><button data-saved-action="duplicate" data-number="${escapeHtml(q.quoteNumber)}">Duplicate</button><button data-saved-action="print" data-number="${escapeHtml(q.quoteNumber)}">Print</button><button data-saved-action="pdf" data-number="${escapeHtml(q.quoteNumber)}">PDF</button><button data-saved-action="share" data-number="${escapeHtml(q.quoteNumber)}">WhatsApp</button><button data-saved-action="delete" data-number="${escapeHtml(q.quoteNumber)}">Delete</button></div></article>`; }).join("") || '<p class="empty-state">No saved quotations found.</p>'; }
  function handleSavedAction(e) { const b = e.target.closest("button[data-saved-action]"); if (!b) return; const quote = readSaved().find((q) => q.quoteNumber === b.dataset.number); if (!quote) return; const action = b.dataset.savedAction;
    if (action === "delete" && confirm(`Delete ${quote.quoteNumber}?`)) { localStorage.setItem(STORAGE.saved, JSON.stringify(readSaved().filter((q) => q.quoteNumber !== quote.quoteNumber))); renderSaved(); toast("Saved quote deleted."); return; }
    if (action === "duplicate") { loadQuote(quote, true); els.savedDialog.close(); toast("Quote duplicated with a new number."); return; }
    loadQuote(quote, false); els.savedDialog.close(); if (action === "print" || action === "pdf") setTimeout(() => printQuote(), 0); if (action === "share") setTimeout(() => prepareWhatsApp(), 0); if (action === "open") toast(`${quote.quoteNumber} opened.`);
  }

  function loadQuote(q, duplicate) { state.quoteNumber = duplicate ? generateQuoteNumber() : q.quoteNumber; state.rows = Array.isArray(q.rows) ? q.rows.map((r) => ({ ...r, id: r.id || uid() })) : []; els.quoteNumber.textContent = state.quoteNumber; els.customerType.value = q.customer?.type || "Walk-in customer"; els.customerName.value = q.customer?.name || ""; els.customerPhone.value = q.customer?.phone || ""; els.customerLocation.value = q.customer?.location || ""; els.quoteDate.value = duplicate ? today() : q.quoteDate || today(); els.discountType.value = q.discountType || (q.discountValue ? "fixed" : "none"); els.discountValue.value = q.discountValue || 0; els.deliveryFee.value = q.fees?.delivery || 0; els.pickupFee.value = q.fees?.pickup || 0; els.urgentFee.value = q.fees?.urgent || 0; els.amountPaid.value = duplicate ? 0 : q.amountPaid || 0; els.quoteNotes.value = q.notes || ""; renderAll(); scheduleDraft(); }

  function prepareWhatsApp() { if (!requireRows()) return; if (!validatePhoneValue(els.customerPhone.value)) { els.sharePhone.value = els.customerPhone.value; els.sharePhoneError.textContent = ""; els.phoneDialog.showModal(); els.sharePhone.focus(); return; } openWhatsApp(els.customerPhone.value); }
  function openWhatsApp(phone) { withLoading(els.shareWhatsapp, "Preparing…", () => { const t = totals(), c = customer(); const lines = state.rows.map((r) => `• ${r.itemName} × ${quantity(r.quantity)} — ${money(lineTotal(r))}`).join("\n"); const message = `${BUSINESS.name}\nQuotation ${state.quoteNumber}\nCustomer: ${c.name || c.type}\n\n${lines}\n\nGrand total: ${money(t.grandTotal)}\nAmount paid: ${money(t.amountPaid)}\n${t.changeDue ? "Change due" : "Balance due"}: ${money(t.changeDue || t.balanceDue)}\n\nPayment: ${BUSINESS.paymentMethod}\n${BUSINESS.paymentNumber}\n\nCall / WhatsApp: ${BUSINESS.phone}`; window.open(`https://wa.me/${formatPhone(phone)}?text=${encodeURIComponent(message)}`, "_blank", "noopener"); toast("WhatsApp message prepared."); }); }

  function onQuoteChange(event) { if (event.target === els.discountType && els.discountType.value === "none") els.discountValue.value = 0; validatePhone(); renderAll(); scheduleDraft(); }
  function scheduleDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => { if (hasInformation()) localStorage.setItem(STORAGE.draft, JSON.stringify(serialize())); else localStorage.removeItem(STORAGE.draft); }, 250); }
  function recoverDraft() { try { loadQuote(JSON.parse(localStorage.getItem(STORAGE.draft)), false); toast("Unfinished quotation restored."); } catch { toast("The unfinished quotation could not be restored.", true); } els.recoveryDialog.close(); }
  function requestNewQuote(confirmNeeded) { if (confirmNeeded && hasInformation() && !confirm("Start a new quote? Unsaved information in the current quote will be cleared.")) return; localStorage.removeItem(STORAGE.draft); resetQuote(true); toast("New quote ready."); }
  function resetQuote(newNumber) { state.quoteNumber = newNumber || !state.quoteNumber ? generateQuoteNumber() : state.quoteNumber; state.rows = []; state.editingRowId = null; els.quoteNumber.textContent = state.quoteNumber; els.customerType.value = "Walk-in customer"; [els.customerName, els.customerPhone, els.customerLocation, els.quoteNotes].forEach((e) => e.value = ""); els.quoteDate.value = today(); els.discountType.value = "none"; [els.discountValue, els.deliveryFee, els.pickupFee, els.urgentFee, els.amountPaid].forEach((e) => e.value = 0); els.serviceCategory.value = ""; populateServices(); clearServiceForm(); renderAll(); }
  function hasInformation() { return state.rows.length || els.customerName.value || els.customerPhone.value || els.customerLocation.value || positive(els.discountValue.value) || positive(els.deliveryFee.value) || positive(els.pickupFee.value) || positive(els.urgentFee.value) || positive(els.amountPaid.value) || els.quoteNotes.value; }

  function validatePhone() { const value = els.customerPhone.value.trim(), valid = !value || validatePhoneValue(value); els.customerPhone.classList.toggle("input-error", !valid); els.customerPhoneError.textContent = valid ? "" : "Enter a valid Kenyan phone number."; els.customerPhone.setAttribute("aria-invalid", String(!valid)); return valid; }
  function validatePhoneValue(value) { return /^(?:(?:\+?254)|0)(?:1|7)\d{8}$/.test(String(value).replace(/[\s()-]/g, "")); }
  function requireRows() { if (state.rows.length) return true; toast("Add at least one service first.", true); return false; }
  function setupProgress() { const links = [...document.querySelectorAll(".progress a")], sections = links.map((l) => document.querySelector(l.hash)); if (!("IntersectionObserver" in window)) return; const observer = new IntersectionObserver((entries) => { const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (visible) links.forEach((l) => l.classList.toggle("active", l.hash === `#${visible.target.id}`)); }, { rootMargin: "-25% 0px -60%", threshold: [0, .3, .7] }); sections.forEach((s) => observer.observe(s)); }

  function customer() { return { type: els.customerType.value, name: els.customerName.value.trim(), phone: els.customerPhone.value.trim(), location: els.customerLocation.value.trim() }; }
  function quoteTotals(q) {
    const subtotal = cents((q.rows || []).reduce((sum, row) => sum + lineTotal(row), 0));
    const value = positive(q.discountValue), discount = q.discountType === "percentage" ? cents(subtotal * Math.min(value, 100) / 100) : q.discountType === "fixed" ? Math.min(value, subtotal) : 0;
    const extras = cents(positive(q.fees?.delivery) + positive(q.fees?.pickup) + positive(q.fees?.urgent));
    return { grandTotal: cents(subtotal - discount + extras), amountPaid: positive(q.amountPaid) };
  }
  function lineTotal(r) { return cents(number(r.quantity) * number(r.unitPrice)); }
  function isCustomPrice(r) { return r.defaultPrice != null && cents(r.unitPrice) !== cents(r.defaultPrice); }
  function updatePriceHint(s) { els.priceHint.textContent = s.defaultPrice == null ? "Enter the agreed price." : number(els.unitPrice.value) !== s.defaultPrice ? `Custom price · Standard ${money(s.defaultPrice)}` : `Standard price: ${money(s.defaultPrice)}`; }
  function readUnit(select, input) { return select.value === "custom" ? input.value.trim() || "custom" : select.value; }
  function setUnit(unit) { els.unitType.value = UNITS.includes(unit) ? unit : "custom"; els.customUnit.value = UNITS.includes(unit) ? "" : unit; toggleUnit(els.unitType, els.customUnitWrap); }
  function toggleUnit(select, wrap) { wrap.classList.toggle("hidden", select.value !== "custom"); }
  function withLoading(button, label, work) { if (!button) return work(); const original = button.textContent; button.disabled = true; button.textContent = label; setTimeout(() => { try { work(); } finally { button.textContent = original; updateActions(); } }, 80); }
  function toast(message, error = false) { els.toast.textContent = message; els.toast.className = `toast show${error ? " error" : ""}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3500); }
  function showError(el, message) { el.textContent = message; }
  function money(value) { return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(number(value)).replace("Ksh", "KES").replace(/\s+/g, " "); }
  function quantity(value) { return Number.isInteger(number(value)) ? String(number(value)) : number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); }
  function number(value) { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : 0; }
  function positive(value) { return Math.max(0, number(value)); }
  function cents(value) { return Math.round(number(value) * 100) / 100; }
  function normalize(value) { return String(value || "").trim().toLowerCase(); }
  function toCamel(id) { return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function displayDate(value) { if (!value) return "Not dated"; return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
  function formatPhone(value) { const digits = String(value).replace(/\D/g, ""); return digits.startsWith("0") ? `254${digits.slice(1)}` : digits.startsWith("254") ? digits : `254${digits}`; }
  function getQuotationFileName() {
    const c = customer();
    const customerReference = c.name || c.phone || state.quoteNumber;
    const safeReference = customerReference.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, " ").trim();
    return `FreshFold Quotation - ${safeReference}`;
  }
  function generateQuoteNumber() { const date = today().replaceAll("-", ""); let counter = 1; try { const saved = JSON.parse(localStorage.getItem(STORAGE.counter) || "{}"); counter = saved.date === date ? number(saved.serial) + 1 : 1; localStorage.setItem(STORAGE.counter, JSON.stringify({ date, serial: counter })); } catch {} return `FF-${date}-${String(counter).padStart(3, "0")}`; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
})();
