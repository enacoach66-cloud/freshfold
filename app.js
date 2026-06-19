(function () {
  "use strict";

  const BUSINESS = {
    name: "FreshFold Laundry",
    tagline: "Fresh. Clean. Delivered.",
    phone: "0100677971",
    terms: "Prices may change after inspection for heavily stained, oversized, or special fabric items."
  };

  const STANDARD_UNITS = ["piece", "kg", "set", "meter"];
  const QUICK_ADD_IDS = [
    "duvet-4x6",
    "duvet-6x6",
    "blankets",
    "clothes-per-kg",
    "suits",
    "jackets-towels",
    "fluffy-carpet",
    "sofas-chester-beds"
  ];

  const priceList = Array.isArray(window.FRESHFOLD_PRICE_LIST) ? window.FRESHFOLD_PRICE_LIST : [];
  const services = priceList
    .filter((group) => group.active !== false)
    .flatMap((group) =>
      group.items
        .filter((item) => item.active !== false)
        .map((item) => ({
          ...item,
          category: group.category,
          categoryId: group.id
        }))
    );
  const categories = [...new Set(services.map((service) => service.category))];

  const state = {
    quoteNumber: generateQuoteNumber(),
    rows: [],
    editingRowId: null
  };

  const els = {};

  function boot() {
    bindElements();
    populateCategoryOptions();
    populateItemOptions();
    renderQuickAdd();
    setInitialValues();
    bindEvents();
    renderAll();
  }

  function bindElements() {
    [
      "quote-number",
      "customer-name",
      "customer-phone",
      "customer-phone-error",
      "customer-location",
      "quote-date",
      "service-category",
      "service-item",
      "unit-type",
      "custom-unit-wrap",
      "custom-unit",
      "quantity",
      "unit-price",
      "price-hint",
      "item-note",
      "item-form-error",
      "price-item-form",
      "add-item-button",
      "cancel-edit",
      "quick-add-list",
      "custom-item-form",
      "custom-item-name",
      "custom-category",
      "custom-price",
      "custom-unit-type",
      "custom-form-unit-wrap",
      "custom-form-unit",
      "custom-quantity",
      "custom-note",
      "custom-form-error",
      "empty-state",
      "quote-table-wrap",
      "quote-lines",
      "item-count",
      "subtotal",
      "discount-type",
      "discount-value",
      "discount-total",
      "delivery-fee",
      "pickup-fee",
      "urgent-fee",
      "extra-charges",
      "grand-total",
      "amount-paid",
      "balance-due",
      "quote-notes",
      "status-message",
      "save-quote",
      "print-quote",
      "download-pdf",
      "share-whatsapp",
      "mobile-grand-total",
      "mobile-print",
      "category-options",
      "item-options",
      "quote-preview"
    ].forEach((id) => {
      els[toCamel(id)] = document.getElementById(id);
    });
  }

  function setInitialValues() {
    els.quoteNumber.textContent = state.quoteNumber;
    els.quoteDate.value = toDateInputValue(new Date());
    els.quantity.value = "1";
    els.customQuantity.value = "1";
  }

  function bindEvents() {
    els.serviceCategory.addEventListener("input", () => {
      populateItemOptions();
      updatePriceHint();
    });
    els.serviceItem.addEventListener("input", handleServiceSelection);
    els.unitType.addEventListener("change", () => toggleCustomUnit(els.unitType, els.customUnitWrap, els.customUnit));
    els.customUnitType.addEventListener("change", () =>
      toggleCustomUnit(els.customUnitType, els.customFormUnitWrap, els.customFormUnit)
    );
    els.unitPrice.addEventListener("input", updatePriceHint);
    els.priceItemForm.addEventListener("submit", handlePriceItemSubmit);
    els.customItemForm.addEventListener("submit", handleCustomItemSubmit);
    els.cancelEdit.addEventListener("click", clearPriceForm);
    els.quickAddList.addEventListener("click", handleQuickAdd);
    els.quoteLines.addEventListener("click", handleRowAction);
    els.quoteLines.addEventListener("change", handleRowFieldChange);
    els.customerPhone.addEventListener("input", validatePhoneField);

    [
      els.customerName,
      els.customerPhone,
      els.customerLocation,
      els.quoteDate,
      els.discountType,
      els.discountValue,
      els.deliveryFee,
      els.pickupFee,
      els.urgentFee,
      els.amountPaid,
      els.quoteNotes
    ].forEach((input) => {
      input.addEventListener("input", renderAll);
      input.addEventListener("change", renderAll);
    });

    els.saveQuote.addEventListener("click", saveQuote);
    els.printQuote.addEventListener("click", printQuote);
    els.downloadPdf.addEventListener("click", printQuote);
    els.shareWhatsapp.addEventListener("click", shareWhatsApp);
    els.mobilePrint.addEventListener("click", printQuote);
  }

  function populateCategoryOptions() {
    els.categoryOptions.innerHTML = "";
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      els.categoryOptions.appendChild(option);
    });
  }

  function populateItemOptions() {
    const selectedCategory = normalize(els.serviceCategory.value);
    const filtered = selectedCategory
      ? services.filter((service) => normalize(service.category) === selectedCategory)
      : services;

    els.itemOptions.innerHTML = "";
    filtered.forEach((service) => {
      const option = document.createElement("option");
      option.value = service.name;
      option.label = service.category;
      els.itemOptions.appendChild(option);
    });
  }

  function renderQuickAdd() {
    const quickItems = QUICK_ADD_IDS.map((id) => services.find((service) => service.id === id)).filter(Boolean);
    els.quickAddList.innerHTML = quickItems
      .map(
        (service) => `
          <button class="quick-button" type="button" data-service-id="${escapeHtml(service.id)}">
            <span>${escapeHtml(service.name)}</span>
            <strong>${formatMoney(service.defaultPrice)}</strong>
          </button>
        `
      )
      .join("");
  }

  function handleServiceSelection() {
    const service = findSelectedService();
    if (!service) {
      updatePriceHint();
      return;
    }

    els.serviceCategory.value = service.category;
    els.serviceItem.value = service.name;
    setUnitValue(els.unitType, els.customUnitWrap, els.customUnit, service.unitType);
    els.unitPrice.value = service.defaultPrice === null ? "" : String(service.defaultPrice);
    populateItemOptions();
    updatePriceHint();
  }

  function handlePriceItemSubmit(event) {
    event.preventDefault();
    const result = buildRowFromPriceForm();
    if (!result.ok) {
      showFormError(els.itemFormError, result.message);
      return;
    }

    if (state.editingRowId) {
      state.rows = state.rows.map((row) => (row.id === state.editingRowId ? { ...result.row, id: row.id } : row));
      showStatus("Quote row updated.");
    } else {
      state.rows.push(result.row);
      showStatus("Item added to quote.");
    }

    clearPriceForm();
    renderAll();
  }

  function handleCustomItemSubmit(event) {
    event.preventDefault();
    const itemName = els.customItemName.value.trim();
    const category = els.customCategory.value.trim();
    const unitPrice = parseOptionalNumber(els.customPrice.value);
    const quantity = parseOptionalNumber(els.customQuantity.value);
    const unitResult = readUnit(els.customUnitType, els.customFormUnit);

    if (!itemName) {
      showFormError(els.customFormError, "Enter the custom item name.");
      return;
    }
    if (!category) {
      showFormError(els.customFormError, "Enter a category for the custom item.");
      return;
    }
    if (!unitResult.ok) {
      showFormError(els.customFormError, unitResult.message);
      return;
    }
    if (quantity === null || quantity <= 0) {
      showFormError(els.customFormError, "Quantity must be more than zero.");
      return;
    }
    if (unitPrice === null || unitPrice < 0) {
      showFormError(els.customFormError, "Price must be zero or more.");
      return;
    }

    state.rows.push({
      id: createId(),
      category,
      itemName,
      unitType: unitResult.value,
      quantity,
      unitPrice,
      defaultPrice: null,
      sourceId: null,
      custom: true,
      manualPrice: true,
      note: els.customNote.value.trim()
    });

    els.customItemForm.reset();
    els.customQuantity.value = "1";
    toggleCustomUnit(els.customUnitType, els.customFormUnitWrap, els.customFormUnit);
    showFormError(els.customFormError, "");
    showStatus("Custom item added.");
    renderAll();
  }

  function buildRowFromPriceForm() {
    const service = findSelectedService();
    const category = (service ? service.category : els.serviceCategory.value).trim();
    const itemName = (service ? service.name : els.serviceItem.value).trim();
    const quantity = parseOptionalNumber(els.quantity.value);
    const unitPrice = parseOptionalNumber(els.unitPrice.value);
    const unitResult = readUnit(els.unitType, els.customUnit);

    if (!category) {
      return { ok: false, message: "Select or enter a service category." };
    }
    if (!itemName) {
      return { ok: false, message: "Select or enter an item name." };
    }
    if (!unitResult.ok) {
      return { ok: false, message: unitResult.message };
    }
    if (quantity === null || quantity <= 0) {
      return { ok: false, message: "Quantity must be more than zero." };
    }
    if (unitPrice === null || unitPrice < 0) {
      return { ok: false, message: "Price must be zero or more." };
    }

    return {
      ok: true,
      row: {
        id: createId(),
        category,
        itemName,
        unitType: unitResult.value,
        quantity,
        unitPrice,
        defaultPrice: service ? service.defaultPrice : null,
        sourceId: service ? service.id : null,
        custom: !service,
        manualPrice: Boolean(service && service.manualPrice) || !service,
        note: els.itemNote.value.trim()
      }
    };
  }

  function handleQuickAdd(event) {
    const button = event.target.closest("[data-service-id]");
    if (!button) return;

    const service = services.find((item) => item.id === button.dataset.serviceId);
    if (!service) return;

    if (service.defaultPrice === null) {
      els.serviceCategory.value = service.category;
      els.serviceItem.value = service.name;
      setUnitValue(els.unitType, els.customUnitWrap, els.customUnit, service.unitType);
      els.unitPrice.focus();
      updatePriceHint();
      showStatus("Enter a price for this service before adding it.", true);
      return;
    }

    state.rows.push({
      id: createId(),
      category: service.category,
      itemName: service.name,
      unitType: service.unitType,
      quantity: 1,
      unitPrice: service.defaultPrice,
      defaultPrice: service.defaultPrice,
      sourceId: service.id,
      custom: false,
      manualPrice: false,
      note: ""
    });
    showStatus(`${service.name} added.`);
    renderAll();
  }

  function handleRowAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const rowId = button.dataset.rowId;
    const row = state.rows.find((item) => item.id === rowId);
    if (!row) return;

    if (button.dataset.action === "edit") {
      loadRowForEditing(row);
      return;
    }

    if (button.dataset.action === "duplicate") {
      state.rows.push({ ...row, id: createId() });
      showStatus("Row duplicated.");
      renderAll();
      return;
    }

    if (button.dataset.action === "remove") {
      if (window.confirm("Remove this quote item?")) {
        state.rows = state.rows.filter((item) => item.id !== rowId);
        if (state.editingRowId === rowId) clearPriceForm();
        showStatus("Row removed.");
        renderAll();
      }
      return;
    }

    if (button.dataset.action === "reset-price" && row.defaultPrice !== null) {
      row.unitPrice = row.defaultPrice;
      showStatus("Price reset to default.");
      renderAll();
    }
  }

  function handleRowFieldChange(event) {
    const input = event.target.closest("[data-field]");
    if (!input) return;

    const row = state.rows.find((item) => item.id === input.dataset.rowId);
    if (!row) return;

    const value = parseOptionalNumber(input.value);
    if (input.dataset.field === "quantity") {
      if (value === null || value <= 0) {
        input.value = String(row.quantity);
        showStatus("Quantity must be more than zero.", true);
        return;
      }
      row.quantity = value;
    }

    if (input.dataset.field === "unitPrice") {
      if (value === null || value < 0) {
        input.value = String(row.unitPrice);
        showStatus("Price must be zero or more.", true);
        return;
      }
      row.unitPrice = value;
    }

    renderAll();
  }

  function loadRowForEditing(row) {
    state.editingRowId = row.id;
    els.serviceCategory.value = row.category;
    els.serviceItem.value = row.itemName;
    setUnitValue(els.unitType, els.customUnitWrap, els.customUnit, row.unitType);
    els.quantity.value = String(row.quantity);
    els.unitPrice.value = String(row.unitPrice);
    els.itemNote.value = row.note || "";
    els.addItemButton.textContent = "Update row";
    els.cancelEdit.classList.remove("hidden");
    populateItemOptions();
    updatePriceHint(row);
    els.serviceItem.focus();
    showFormError(els.itemFormError, "");
  }

  function clearPriceForm() {
    state.editingRowId = null;
    els.priceItemForm.reset();
    els.quantity.value = "1";
    els.unitType.value = "piece";
    toggleCustomUnit(els.unitType, els.customUnitWrap, els.customUnit);
    els.addItemButton.textContent = "Add item";
    els.cancelEdit.classList.add("hidden");
    showFormError(els.itemFormError, "");
    updatePriceHint();
    populateItemOptions();
  }

  function renderAll() {
    validatePhoneField();
    renderTable();
    renderSummary();
    renderPreview();
  }

  function renderTable() {
    const hasRows = state.rows.length > 0;
    els.emptyState.classList.toggle("hidden", hasRows);
    els.quoteTableWrap.classList.toggle("hidden", !hasRows);
    els.itemCount.textContent = `${state.rows.length} ${state.rows.length === 1 ? "item" : "items"}`;

    els.quoteLines.innerHTML = state.rows
      .map((row) => {
        const priceLabel = getPriceLabel(row);
        const resetButton =
          row.defaultPrice !== null && isPriceOverridden(row)
            ? `<button class="mini-button" type="button" data-action="reset-price" data-row-id="${row.id}">Reset</button>`
            : "";

        return `
          <tr>
            <td data-label="Category">${escapeHtml(row.category)}</td>
            <td data-label="Item">
              <strong>${escapeHtml(row.itemName)}</strong>
              ${row.note ? `<small>${escapeHtml(row.note)}</small>` : ""}
            </td>
            <td data-label="Unit">${escapeHtml(row.unitType)}</td>
            <td data-label="Qty">
              <input class="table-input" data-field="quantity" data-row-id="${row.id}" type="number" min="0.01" step="0.01" value="${row.quantity}" aria-label="Quantity for ${escapeHtml(row.itemName)}" />
            </td>
            <td data-label="Unit price">
              <input class="table-input price-input" data-field="unitPrice" data-row-id="${row.id}" type="number" min="0" step="1" value="${row.unitPrice}" aria-label="Unit price for ${escapeHtml(row.itemName)}" />
              ${priceLabel ? `<span class="price-label">${priceLabel}</span>` : ""}
              ${resetButton}
            </td>
            <td data-label="Line total"><strong>${formatMoney(getLineTotal(row))}</strong></td>
            <td data-label="Actions">
              <div class="row-actions">
                <button type="button" data-action="edit" data-row-id="${row.id}">Edit</button>
                <button type="button" data-action="duplicate" data-row-id="${row.id}">Duplicate</button>
                <button type="button" data-action="remove" data-row-id="${row.id}">Remove</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderSummary() {
    const totals = getTotals();
    els.subtotal.textContent = formatMoney(totals.subtotal);
    els.discountTotal.textContent = `- ${formatMoney(totals.discount)}`;
    els.extraCharges.textContent = formatMoney(totals.extraCharges);
    els.grandTotal.textContent = formatMoney(totals.grandTotal);
    els.mobileGrandTotal.textContent = formatMoney(totals.grandTotal);
    els.balanceDue.textContent = formatMoney(totals.balanceDue);
  }

  function renderPreview() {
    const totals = getTotals();
    const customer = getCustomer();
    const quoteDate = els.quoteDate.value || toDateInputValue(new Date());
    const rowsHtml = state.rows.length
      ? state.rows
          .map(
            (row, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>
                  <strong>${escapeHtml(row.itemName)}</strong>
                  <span>${escapeHtml(row.category)}${row.note ? ` - ${escapeHtml(row.note)}` : ""}</span>
                </td>
                <td>${escapeHtml(row.unitType)}</td>
                <td>${formatQuantity(row.quantity)}</td>
                <td>${formatMoney(row.unitPrice)}</td>
                <td>${formatMoney(getLineTotal(row))}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="6" class="preview-empty">No quotation items added.</td></tr>`;

    els.quotePreview.innerHTML = `
      <article class="quotation-sheet">
        <header class="preview-header">
          <div>
            <div class="preview-logo"><span>Fresh</span>Fold</div>
            <p>${BUSINESS.tagline}</p>
            <p>Call / WhatsApp: ${BUSINESS.phone}</p>
          </div>
          <div class="preview-meta">
            <strong>Quotation</strong>
            <span>${escapeHtml(state.quoteNumber)}</span>
            <small>${formatDisplayDate(quoteDate)}</small>
          </div>
        </header>

        <section class="preview-customer">
          <div>
            <span>Customer</span>
            <strong>${escapeHtml(customer.name || "Walk-in customer")}</strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>${escapeHtml(customer.phone || "Not provided")}</strong>
          </div>
          <div>
            <span>Location</span>
            <strong>${escapeHtml(customer.location || "Not provided")}</strong>
          </div>
        </section>

        <table class="preview-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Unit</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>

        <section class="preview-totals">
          <div><span>Subtotal</span><strong>${formatMoney(totals.subtotal)}</strong></div>
          <div><span>Discount</span><strong>- ${formatMoney(totals.discount)}</strong></div>
          <div><span>Extra charges</span><strong>${formatMoney(totals.extraCharges)}</strong></div>
          <div class="preview-grand"><span>Grand total</span><strong>${formatMoney(totals.grandTotal)}</strong></div>
          <div><span>Amount paid</span><strong>${formatMoney(totals.amountPaid)}</strong></div>
          <div><span>Balance due</span><strong>${formatMoney(totals.balanceDue)}</strong></div>
        </section>

        ${els.quoteNotes.value.trim() ? `<p class="preview-note">${escapeHtml(els.quoteNotes.value.trim())}</p>` : ""}
        <p class="terms-note">${BUSINESS.terms}</p>
      </article>
    `;
  }

  function getTotals() {
    const subtotal = state.rows.reduce((sum, row) => sum + getLineTotal(row), 0);
    const discountValue = Math.max(0, parseOptionalNumber(els.discountValue.value) || 0);
    const discount =
      els.discountType.value === "percentage"
        ? Math.min(subtotal, subtotal * (discountValue / 100))
        : Math.min(subtotal, discountValue);
    const delivery = Math.max(0, parseOptionalNumber(els.deliveryFee.value) || 0);
    const pickup = Math.max(0, parseOptionalNumber(els.pickupFee.value) || 0);
    const urgent = Math.max(0, parseOptionalNumber(els.urgentFee.value) || 0);
    const extraCharges = delivery + pickup + urgent;
    const grandTotal = Math.max(subtotal - discount, 0) + extraCharges;
    const amountPaid = Math.max(0, parseOptionalNumber(els.amountPaid.value) || 0);
    const balanceDue = Math.max(grandTotal - amountPaid, 0);

    return { subtotal, discount, delivery, pickup, urgent, extraCharges, grandTotal, amountPaid, balanceDue };
  }

  function saveQuote() {
    if (!validateQuoteForOutput()) return;

    const quote = {
      quoteNumber: state.quoteNumber,
      savedAt: new Date().toISOString(),
      customer: getCustomer(),
      quoteDate: els.quoteDate.value,
      rows: state.rows,
      totals: getTotals(),
      discountType: els.discountType.value,
      discountValue: Math.max(0, parseOptionalNumber(els.discountValue.value) || 0),
      fees: {
        delivery: Math.max(0, parseOptionalNumber(els.deliveryFee.value) || 0),
        pickup: Math.max(0, parseOptionalNumber(els.pickupFee.value) || 0),
        urgent: Math.max(0, parseOptionalNumber(els.urgentFee.value) || 0)
      },
      amountPaid: Math.max(0, parseOptionalNumber(els.amountPaid.value) || 0),
      notes: els.quoteNotes.value.trim()
    };

    try {
      const savedQuotes = JSON.parse(localStorage.getItem("freshfoldSavedQuotes") || "[]");
      const nextQuotes = Array.isArray(savedQuotes)
        ? [quote, ...savedQuotes.filter((item) => item.quoteNumber !== quote.quoteNumber)]
        : [quote];
      localStorage.setItem("freshfoldSavedQuotes", JSON.stringify(nextQuotes.slice(0, 100)));
      showStatus(`Quote ${state.quoteNumber} saved on this device.`);
    } catch (error) {
      showStatus("Could not save this quote in the browser.", true);
    }
  }

  function printQuote() {
    if (!validateQuoteForOutput()) return;
    showStatus("Opening the clean print view.");
    window.print();
  }

  function shareWhatsApp() {
    if (!validateQuoteForOutput()) return;

    const customer = getCustomer();
    const totals = getTotals();
    const itemSummary = state.rows
      .map((row, index) => `${index + 1}. ${row.itemName} x ${formatQuantity(row.quantity)} - ${formatMoney(getLineTotal(row))}`)
      .join("\n");
    const message = [
      `${BUSINESS.name} quotation`,
      `Customer: ${customer.name || "Walk-in customer"}`,
      `Quote number: ${state.quoteNumber}`,
      "",
      itemSummary,
      "",
      `Grand total: ${formatMoney(totals.grandTotal)}`,
      `FreshFold Laundry phone: ${BUSINESS.phone}`
    ].join("\n");

    const targetPhone = customer.phone ? formatPhoneForWhatsApp(customer.phone) : "";
    const url = targetPhone
      ? `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener");
    showStatus("WhatsApp share opened.");
  }

  function validateQuoteForOutput() {
    if (!validatePhoneField()) {
      showStatus("Check the customer phone number before continuing.", true);
      return false;
    }
    if (state.rows.length === 0) {
      showStatus("Add at least one item before saving or sharing.", true);
      return false;
    }
    const invalidRow = state.rows.find((row) => row.quantity <= 0 || row.unitPrice < 0);
    if (invalidRow) {
      showStatus("Fix item quantities and prices before continuing.", true);
      return false;
    }
    return true;
  }

  function validatePhoneField() {
    const phone = els.customerPhone.value.trim();
    const digits = phone.replace(/\D/g, "");
    const valid = !phone || (digits.length >= 9 && digits.length <= 15);
    els.customerPhoneError.textContent = valid ? "" : "Enter 9 to 15 digits, with optional +.";
    els.customerPhone.classList.toggle("input-error", !valid);
    return valid;
  }

  function getCustomer() {
    return {
      name: els.customerName.value.trim(),
      phone: els.customerPhone.value.trim(),
      location: els.customerLocation.value.trim()
    };
  }

  function findSelectedService() {
    const itemName = normalize(els.serviceItem.value);
    const category = normalize(els.serviceCategory.value);
    if (!itemName) return null;

    return (
      services.find((service) => normalize(service.name) === itemName && normalize(service.category) === category) ||
      services.find((service) => normalize(service.name) === itemName) ||
      null
    );
  }

  function getLineTotal(row) {
    return row.quantity * row.unitPrice;
  }

  function getPriceLabel(row) {
    if (row.defaultPrice === null) return "Manual price";
    if (isPriceOverridden(row)) return "Changed";
    return "";
  }

  function isPriceOverridden(row) {
    return row.defaultPrice !== null && Number(row.unitPrice) !== Number(row.defaultPrice);
  }

  function updatePriceHint(editingRow) {
    const row = editingRow || null;
    const service = row ? services.find((item) => item.id === row.sourceId) : findSelectedService();
    const typedPrice = parseOptionalNumber(els.unitPrice.value);

    if (!service) {
      els.priceHint.textContent = typedPrice !== null ? "Custom price" : "";
      return;
    }

    if (service.defaultPrice === null) {
      els.priceHint.textContent = "Manual price required";
      return;
    }

    els.priceHint.textContent =
      typedPrice !== null && typedPrice !== service.defaultPrice
        ? `Default ${formatMoney(service.defaultPrice)} - manually changed`
        : `Default ${formatMoney(service.defaultPrice)}`;
  }

  function readUnit(select, customInput) {
    if (select.value !== "custom") return { ok: true, value: select.value };
    const value = customInput.value.trim();
    if (!value) return { ok: false, message: "Enter the custom unit type." };
    return { ok: true, value };
  }

  function setUnitValue(select, wrap, input, unit) {
    if (STANDARD_UNITS.includes(unit)) {
      select.value = unit;
      input.value = "";
    } else {
      select.value = "custom";
      input.value = unit || "";
    }
    toggleCustomUnit(select, wrap, input);
  }

  function toggleCustomUnit(select, wrap, input) {
    const isCustom = select.value === "custom";
    wrap.classList.toggle("hidden", !isCustom);
    if (!isCustom) input.value = "";
  }

  function showFormError(element, message) {
    element.textContent = message || "";
  }

  function showStatus(message, isError) {
    els.statusMessage.textContent = message;
    els.statusMessage.classList.toggle("error", Boolean(isError));
  }

  function formatMoney(value) {
    const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
    const hasCents = Math.round(amount) !== amount;
    return `KES ${amount.toLocaleString("en-KE", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0
    })}`;
  }

  function formatQuantity(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : number.toLocaleString("en-KE", { maximumFractionDigits: 2 });
  }

  function parseOptionalNumber(value) {
    if (String(value).trim() === "") return null;
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function generateQuoteNumber() {
    const today = toCompactDate(new Date());
    try {
      const stored = JSON.parse(localStorage.getItem("freshfoldQuoteCounter") || "{}");
      const nextSerial = stored.date === today ? Number(stored.serial || 0) + 1 : 1;
      localStorage.setItem("freshfoldQuoteCounter", JSON.stringify({ date: today, serial: nextSerial }));
      return `FF-${today}-${String(nextSerial).padStart(3, "0")}`;
    } catch (error) {
      return `FF-${today}-${Math.floor(100 + Math.random() * 900)}`;
    }
  }

  function toCompactDate(date) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  }

  function toDateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDisplayDate(value) {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    if (!year || !month || !day) return value;
    return `${day}/${month}/${year}`;
  }

  function formatPhoneForWhatsApp(phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("0")) return `254${digits.slice(1)}`;
    return digits;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
