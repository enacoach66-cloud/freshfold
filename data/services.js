window.FRESHFOLD_PRICE_LIST = [
  {
    id: "bedding-linen",
    category: "Bedding & Linen",
    active: true,
    items: [
      { id: "duvet-4x6", name: "Duvets 4 by 6", defaultPrice: 350, unitType: "piece", active: true },
      { id: "duvet-5x6", name: "Duvets 5 by 6", defaultPrice: 400, unitType: "piece", active: true },
      { id: "duvet-6x6", name: "Duvets 6 by 6", defaultPrice: 450, unitType: "piece", active: true },
      { id: "bedsheets-curtains", name: "Bedsheets or Curtains", defaultPrice: 150, unitType: "piece", active: true },
      { id: "blankets", name: "Blankets", defaultPrice: 200, unitType: "piece", active: true }
    ]
  },
  {
    id: "clothes",
    category: "Clothes",
    active: true,
    items: [
      { id: "clothes-per-kg", name: "Clothes per kg", defaultPrice: 60, unitType: "kg", active: true },
      { id: "suits", name: "Suits", defaultPrice: 350, unitType: "piece", active: true },
      { id: "jackets-towels", name: "Jackets or Towels", defaultPrice: 100, unitType: "piece", active: true },
      { id: "door-mats", name: "Door mats", defaultPrice: 150, unitType: "piece", active: true }
    ]
  },
  {
    id: "carpets",
    category: "Carpets",
    active: true,
    items: [
      { id: "fluffy-carpet", name: "Fluffy carpet", defaultPrice: 300, unitType: "meter", active: true },
      { id: "soft-carpet", name: "Soft carpet", defaultPrice: 400, unitType: "meter", active: true },
      {
        id: "sofas-chester-beds",
        name: "Washing sofas and chester beds, vacuum dry",
        defaultPrice: 2500,
        unitType: "set",
        active: true
      }
    ]
  },
  {
    id: "special-services",
    category: "Special Services",
    active: true,
    items: [
      { id: "wash-iron", name: "Wash and Iron", defaultPrice: null, unitType: "piece", active: true, manualPrice: true },
      { id: "stain-removal", name: "Stain Removal", defaultPrice: null, unitType: "piece", active: true, manualPrice: true },
      { id: "baby-wash", name: "Baby wash", defaultPrice: null, unitType: "kg", active: true, manualPrice: true }
    ]
  }
];

// Backward-compatible alias for the earlier application build.
window.WASHWAVE_PRICE_LIST = window.FRESHFOLD_PRICE_LIST;
