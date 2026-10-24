"""Deterministically generates the motor-component-shortage simulation scenario."""
import json, random, sys

rng = random.Random(4471)
out_path = sys.argv[1]

BUILDING = {"width": 72, "depth": 48, "height": 12}
ZONES = [
    {"id": "Z-RCV", "name": "Receiving", "kind": "receiving", "bounds": {"x": -34, "z": 12, "width": 20, "depth": 10}},
    {"id": "Z-INS", "name": "Inspection & Quarantine", "kind": "inspection", "bounds": {"x": -11, "z": 12, "width": 22, "depth": 10}},
    {"id": "Z-DSP", "name": "Dispatch", "kind": "dispatch", "bounds": {"x": 14, "z": 12, "width": 20, "depth": 10}},
    {"id": "Z-STA", "name": "Bulk Storage", "kind": "storage", "bounds": {"x": -34, "z": -22, "width": 30, "depth": 30}},
    {"id": "Z-STB", "name": "Fast Movers", "kind": "storage", "bounds": {"x": 2, "z": -22, "width": 22, "depth": 30}},
    {"id": "Z-EQP", "name": "Equipment & Charging", "kind": "equipment", "bounds": {"x": 26, "z": -22, "width": 8, "depth": 16}},
    {"id": "Z-CTL", "name": "Control Room", "kind": "control", "bounds": {"x": 26, "z": -4, "width": 8, "depth": 12}},
]

RACK_DEPTH, BAY_WIDTH, LEVEL_HEIGHT = 1.1, 2.7, 1.6
aisles, racks = [], []

def build_zone_aisles(zone_id, start_index, centers, bays, z0):
    for i, cx in enumerate(centers):
        aid = f"A{start_index + i:02d}"
        aisles.append({"id": aid, "zoneId": zone_id, "x": cx, "z": z0 + bays * BAY_WIDTH / 2,
                       "length": bays * BAY_WIDTH, "width": 3.2, "orientation": "z"})
        for side_i, side in enumerate(("left", "right")):
            rx = cx - (1.6 + RACK_DEPTH / 2) if side == "left" else cx + (1.6 + RACK_DEPTH / 2)
            for b in range(bays):
                rnum = side_i * bays + b + 1
                racks.append({"id": f"{aid}-R{rnum:02d}", "aisleId": aid, "side": side,
                              "x": round(rx, 2), "z": round(z0 + BAY_WIDTH * (b + 0.5), 2),
                              "width": BAY_WIDTH, "depth": RACK_DEPTH, "levels": 4,
                              "positionsPerLevel": 3, "levelHeight": LEVEL_HEIGHT})

build_zone_aisles("Z-STA", 1, [-30.4, -24.8, -19.2, -13.6], 8, -21)
build_zone_aisles("Z-STB", 5, [6.2, 11.8, 17.4], 6, -21)

DOCKS = [{"id": f"D0{i+1}", "label": f"Dock {i+1}", "x": x, "z": 24, "side": "south",
          "purpose": "receiving" if i < 3 else "dispatch", "status": "available"}
         for i, x in enumerate([-30, -24, -18, 18, 24, 30])]

layout = {"id": "WH-SIM-01", "name": "Plant 2 Distribution Center", "version": 3,
          "building": BUILDING, "zones": ZONES, "aisles": aisles, "racks": racks, "docks": DOCKS}

SKUS = [
    # sku, description, unit, (min,max) lot qty, reorder point, preferred zone
    ("MTR-7.5KW-IE3", "7.5 kW IE3 induction motor, B3 foot mount", "pcs", (8, 15), 20, "B"),
    ("STL-ASM-FRAME-220", "Welded steel base frame assembly, 220 mm", "pcs", (6, 12), 15, "A"),
    ("MTR-2.2KW-IE3", "2.2 kW IE3 induction motor, B14 flange", "pcs", (10, 30), 12, "B"),
    ("MTR-11KW-IE4", "11 kW IE4 premium efficiency motor", "pcs", (4, 10), 6, "B"),
    ("GBX-HEL-40", "Helical gearbox, ratio 40:1", "pcs", (4, 12), 5, "B"),
    ("GBX-WRM-25", "Worm gearbox, ratio 25:1, hollow shaft", "pcs", (6, 14), 6, "B"),
    ("BRG-6205-2RS", "Deep groove ball bearing 6205-2RS", "pcs", (120, 400), 150, "B"),
    ("BRG-22210-E", "Spherical roller bearing 22210-E", "pcs", (30, 90), 40, "B"),
    ("CPL-JAW-L100", "Jaw coupling L100 with spider insert", "pcs", (20, 60), 25, "B"),
    ("VFD-7.5-400V", "Variable frequency drive 7.5 kW 400 V", "pcs", (3, 10), 4, "B"),
    ("PLC-IO-16DI", "PLC digital input module, 16 ch", "pcs", (10, 40), 12, "B"),
    ("SNS-PROX-M18", "Inductive proximity sensor M18", "pcs", (40, 120), 50, "B"),
    ("CBL-4C-2.5", "Power cable 4-core 2.5 mm², 100 m reel", "reel", (4, 12), 5, "A"),
    ("HOS-HYD-12", "Hydraulic hose 1/2\" 2SN, 50 m coil", "coil", (3, 10), 4, "A"),
    ("VLV-BAL-DN50", "Ball valve DN50 PN40, stainless", "pcs", (12, 40), 15, "A"),
    ("PMP-CEN-3KW", "Centrifugal pump 3 kW, cast iron", "pcs", (2, 6), 3, "A"),
    ("FST-M12-8.8", "Hex bolt M12x50 grade 8.8, box of 200", "box", (10, 40), 12, "A"),
    ("FST-NUT-M12", "Hex nut M12 grade 8, box of 500", "box", (8, 30), 10, "A"),
    ("STL-PLT-10MM", "Steel plate S355 10 mm, 1250x2500", "sheet", (8, 20), 10, "A"),
    ("STL-BEAM-IPE200", "IPE 200 structural beam, 6 m", "pcs", (6, 16), 8, "A"),
    ("STL-TUBE-60", "Square hollow section 60x60x4, 6 m", "pcs", (10, 30), 12, "A"),
    ("BLT-V-SPA1250", "V-belt SPA 1250", "pcs", (30, 90), 30, "B"),
    ("CHN-ROL-08B", "Roller chain 08B-1, 5 m", "pcs", (10, 40), 12, "B"),
    ("SEL-OIL-45", "Oil seal 45x62x8 NBR", "pcs", (100, 300), 120, "B"),
    ("LUB-GRS-EP2", "EP2 lithium grease, 18 kg pail", "pail", (6, 20), 6, "A"),
    ("PNL-ENC-600", "Steel enclosure 600x600x250", "pcs", (4, 12), 4, "A"),
    ("CTR-MCC-9A", "Motor contactor 9 A, 24 V DC coil", "pcs", (20, 60), 20, "B"),
    ("FLT-HYD-10U", "Hydraulic return filter 10 µm", "pcs", (15, 45), 15, "B"),
    ("WHL-PU-200", "Polyurethane castor wheel 200 mm", "pcs", (12, 36), 12, "A"),
    ("PLT-EUR-WOOD", "Spare EUR wooden pallet", "pcs", (10, 20), 0, "A"),
]
SKU_MAP = {s[0]: s for s in SKUS}

def pos_ids(rack):
    for lvl in range(1, rack["levels"] + 1):
        for p in range(1, rack["positionsPerLevel"] + 1):
            yield f"{rack['id']}-L{lvl:02d}-P{p:02d}"

# Positions kept empty because the scenario puts away recovered stock there
RESERVED_DEST = {"A06-R05-L01-P01", "A06-R05-L01-P02", "A06-R05-L01-P03",
                 "A02-R03-L01-P01", "A02-R03-L01-P02",
                 # Consolidation target for the recommended plan's reallocation action
                 "A05-R02-L01-P03"}
# Positions holding the two disrupted SKUs (motor: 35 total, steel frame: 22 total)
FIXED = {
    "A05-R02-L01-P01": ("MTR-7.5KW-IE3", 15), "A05-R02-L01-P02": ("MTR-7.5KW-IE3", 12),
    "A07-R09-L02-P01": ("MTR-7.5KW-IE3", 8),
    "A01-R04-L01-P01": ("STL-ASM-FRAME-220", 12), "A03-R12-L02-P03": ("STL-ASM-FRAME-220", 10),
}

def ts(day, hour, minute):
    return f"2026-10-{day:02d}T{hour:02d}:{minute:02d}:00Z"

inventory, lot_n = [], 1000
zone_of_aisle = {a["id"]: ("A" if a["zoneId"] == "Z-STA" else "B") for a in aisles}
skus_by_zone = {z: [s for s in SKUS if s[5] == z and s[0] not in ("MTR-7.5KW-IE3", "STL-ASM-FRAME-220")] for z in "AB"}

def make_lot(pid, sku, qty, status):
    global lot_n
    lot_n += 1
    s = SKU_MAP[sku]
    return {"lotId": f"LOT-{lot_n}", "sku": sku, "description": s[1], "positionId": pid, "qty": qty,
            "unit": s[2], "status": status, "reorderPoint": s[4] or None,
            "lastUpdated": ts(rng.randint(14, 23), rng.randint(6, 18), rng.choice([0, 12, 24, 36, 48])),
            "source": "simulated"}

quarantine_left, reserved_left = 4, 14
for rack in racks:
    zone = zone_of_aisle[rack["aisleId"]]
    for pid in pos_ids(rack):
        if pid in RESERVED_DEST:
            continue
        if pid in FIXED:
            sku, qty = FIXED[pid]
            inventory.append(make_lot(pid, sku, qty, "in_stock"))
            continue
        level = int(pid.split("-L")[1][:2])
        if rng.random() > (0.78 if level <= 2 else 0.58):
            continue
        s = rng.choice(skus_by_zone[zone])
        lo, hi = s[3]
        qty = rng.randint(lo, hi)
        status = "in_stock"
        roll = rng.random()
        if roll < 0.08:
            qty = max(1, rng.randint(1, max(1, s[4] // 2)))
            status = "low_stock" if s[4] else "in_stock"
        elif roll < 0.11 and quarantine_left:
            quarantine_left -= 1
            status = "quarantine"
        elif roll < 0.16 and reserved_left:
            reserved_left -= 1
            status = "reserved"
        inventory.append(make_lot(pid, s[0], qty, status))

SUPPLIERS = {
    "SUP-APEX": "Apex Motors Ltd", "SUP-KEST": "Kestrel Drives GmbH", "SUP-NORTH": "Northfield Electric",
    "SUP-VOLTA": "Volta Industrial Supply", "SUP-MERID": "Meridian Steelworks", "SUP-IRON": "Ironbridge Fabrication",
}
sup = lambda sid: {"id": sid, "name": SUPPLIERS[sid]}

equipment = [
    {"id": "FL-01", "type": "forklift", "label": "Forklift 01", "status": "idle", "home": {"x": 28, "z": -20}},
    {"id": "FL-02", "type": "forklift", "label": "Forklift 02", "status": "idle", "home": {"x": 30.5, "z": -20}},
    {"id": "FL-03", "type": "forklift", "label": "Forklift 03", "status": "charging", "home": {"x": 33, "z": -20}},
    {"id": "RT-01", "type": "reach_truck", "label": "Reach Truck 01", "status": "idle", "home": {"x": 28, "z": -16}},
    {"id": "RT-02", "type": "reach_truck", "label": "Reach Truck 02", "status": "maintenance", "home": {"x": 30.5, "z": -16}},
    {"id": "EPJ-01", "type": "electric_pallet_jack", "label": "Electric Pallet Jack 01", "status": "idle", "home": {"x": 33, "z": -16}},
    {"id": "MPJ-01", "type": "manual_pallet_jack", "label": "Manual Pallet Jack 01", "status": "idle", "home": {"x": 28, "z": -12}},
    {"id": "OP-01", "type": "order_picker", "label": "Order Picker 01", "status": "idle", "home": {"x": 30.5, "z": -12}},
    {"id": "SL-01", "type": "scissor_lift", "label": "Scissor Lift 01", "status": "idle", "home": {"x": 33, "z": -12}},
    {"id": "TR-01", "type": "trolley", "label": "Industrial Trolley 01", "status": "idle", "home": {"x": 28, "z": -8}},
    {"id": "CV-01", "type": "conveyor", "label": "Receiving Conveyor", "status": "idle", "home": {"x": -24, "z": 15}},
]
for e in equipment:
    e["currentTask"] = None

shipments = [
    # The failed supplier's inbound: stays Scheduled (no truck), flagged by the disruption
    {"id": "SHP-87990", "supplier": sup("SUP-APEX"), "vehicleType": "container_truck", "dockId": "D01",
     "status": "scheduled", "sku": "MTR-7.5KW-IE3", "qty": 100, "eta": ts(25, 8, 0),
     "milestones": [{"label": "Scheduled", "at": ts(18, 11, 0)}, {"label": "At dock", "at": None},
                    {"label": "Unloaded", "at": None}, {"label": "Departed", "at": None}]},
    {"id": "SHP-88012", "supplier": sup("SUP-VOLTA"), "vehicleType": "delivery_truck", "dockId": None,
     "status": "departed", "sku": "BRG-6205-2RS", "qty": 400, "eta": ts(22, 9, 30),
     "milestones": [{"label": "Scheduled", "at": ts(20, 8, 0)}, {"label": "At dock", "at": ts(22, 9, 34)},
                    {"label": "Unloaded", "at": ts(22, 10, 2)}, {"label": "Departed", "at": ts(22, 10, 15)}]},
    {"id": "SHP-88031", "supplier": sup("SUP-NORTH"), "vehicleType": "trailer_truck", "dockId": None,
     "status": "scheduled", "sku": "CBL-4C-2.5", "qty": 12, "eta": ts(27, 7, 0),
     "milestones": [{"label": "Scheduled", "at": ts(23, 15, 10)}, {"label": "At dock", "at": None},
                    {"label": "Unloaded", "at": None}, {"label": "Departed", "at": None}]},
]

audit = [
    {"id": "AUD-5001", "at": ts(22, 10, 2), "actor": "j.okafor (inventory_manager)", "action": "receipt.verified",
     "entity": "shipment", "entityId": "SHP-88012", "detail": "400 x BRG-6205-2RS received and put away"},
    {"id": "AUD-5002", "at": ts(23, 15, 10), "actor": "m.reyes (procurement)", "action": "shipment.scheduled",
     "entity": "shipment", "entityId": "SHP-88031", "detail": "12 reels CBL-4C-2.5 from Northfield Electric"},
    {"id": "AUD-5003", "at": ts(23, 17, 40), "actor": "s.lindqvist (operator)", "action": "cycle_count.completed",
     "entity": "aisle", "entityId": "A05", "detail": "Cycle count Aisle A05: no variance"},
]

DSR = "DSR-2026-0142"
disruption = {
    "id": DSR, "sku": "MTR-7.5KW-IE3", "description": "7.5 kW IE3 induction motor, B3 foot mount",
    "failedSupplier": sup("SUP-APEX"),
    "reason": "Apex Motors declared force majeure: stator winding line shut down after a plant fire. No shipments for 6+ weeks.",
    "requiredQty": 100, "availableQty": 35, "unit": "pcs", "deadline": "2026-11-06T17:00:00Z",
    "budget": {"amount": 68000, "currency": "USD"},
    "affectedJobs": [
        {"jobId": "JOB-4471", "name": "Conveyor line retrofit, Plant 2", "requiredQty": 60, "deadline": "2026-11-06T17:00:00Z"},
        {"jobId": "JOB-4478", "name": "Pump skid build, Order 7731", "requiredQty": 25, "deadline": "2026-11-10T17:00:00Z"},
        {"jobId": "JOB-4490", "name": "Maintenance spares replenishment", "requiredQty": 15, "deadline": "2026-11-20T17:00:00Z"},
    ],
    "shortages": [
        {"sku": "MTR-7.5KW-IE3", "description": "7.5 kW IE3 induction motor, B3 foot mount", "requiredQty": 100, "availableQty": 35, "gapQty": 65, "unit": "pcs"},
        {"sku": "STL-ASM-FRAME-220", "description": "Welded steel base frame assembly, 220 mm", "requiredQty": 60, "availableQty": 22, "gapQty": 38, "unit": "pcs"},
    ],
    "status": "open", "createdAt": "2026-10-24T08:00:00Z",
}

motor_lots = [l for l in inventory if l["sku"] == "MTR-7.5KW-IE3"]
steel_lots = [l for l in inventory if l["sku"] == "STL-ASM-FRAME-220"]
def restatus(lots, status):
    return [{"type": "inventory.updated", "lot": {**l, "status": status}} for l in lots]

def run(rid, agent, step, status, trace):
    return {"type": "agent.step", "run": {"id": rid, "disruptionId": DSR, "agent": agent, "step": step,
                                          "status": status, "trace": trace}}

options = [
    {"id": "OPT-A", "label": "Kestrel motors + Ironbridge frames (expedited)",
     "lines": [{"supplier": sup("SUP-KEST"), "sku": "MTR-7.5KW-IE3", "qty": 65, "unitPrice": 640},
               {"supplier": sup("SUP-IRON"), "sku": "STL-ASM-FRAME-220", "qty": 38, "unitPrice": 410}],
     "totalCost": {"amount": 57180, "currency": "USD"}, "eta": "2026-10-29T10:00:00Z",
     "meetsDeadline": True, "withinBudget": True, "confidence": 0.86,
     "reasoning": "Kestrel KD-7.5-B3 is a verified drop-in equivalent (same frame size 132S, shaft 38 mm, IE3). Kestrel holds 140 units in its Rotterdam hub; Ironbridge can fabricate 38 frames in 3 days from existing drawings. Arrives 8 days before the JOB-4471 deadline.",
     "sources": ["Supplier catalog: Kestrel Drives (quote Q-KD-2210, valid to 2026-10-31)",
                 "Compatibility agent: datasheet comparison KD-7.5-B3 vs MTR-7.5KW-IE3",
                 "Ironbridge capacity confirmation (email 2026-10-24 09:12)"]},
    {"id": "OPT-B", "label": "Northfield motors + Meridian frames (standard)",
     "lines": [{"supplier": sup("SUP-NORTH"), "sku": "MTR-7.5KW-IE3", "qty": 65, "unitPrice": 560},
               {"supplier": sup("SUP-MERID"), "sku": "STL-ASM-FRAME-220", "qty": 38, "unitPrice": 365}],
     "totalCost": {"amount": 50270, "currency": "USD"}, "eta": "2026-11-09T10:00:00Z",
     "meetsDeadline": False, "withinBudget": True, "confidence": 0.74,
     "reasoning": "Lowest cost, but Northfield's 16-day lead time misses the JOB-4471 deadline by 3 days. Only viable if the retrofit start can slip.",
     "sources": ["Supplier catalog: Northfield Electric (quote Q-NF-5531)", "Meridian Steelworks price list 2026-Q4"]},
    {"id": "OPT-C", "label": "Split order: Kestrel 40 + Volta 25 motors, Ironbridge frames",
     "lines": [{"supplier": sup("SUP-KEST"), "sku": "MTR-7.5KW-IE3", "qty": 40, "unitPrice": 640},
               {"supplier": sup("SUP-VOLTA"), "sku": "MTR-7.5KW-IE3", "qty": 25, "unitPrice": 905},
               {"supplier": sup("SUP-IRON"), "sku": "STL-ASM-FRAME-220", "qty": 38, "unitPrice": 410}],
     "totalCost": {"amount": 63805, "currency": "USD"}, "eta": "2026-10-28T14:00:00Z",
     "meetsDeadline": True, "withinBudget": True, "confidence": 0.69,
     "reasoning": "Fastest arrival and reduces single-supplier risk, but Volta units are a different frame variant (B35) requiring adapter plates; compatibility is unverified for 25 units.",
     "sources": ["Supplier catalog: Volta Industrial Supply (spot quote)", "Compatibility agent: B35 vs B3 mount, unverified"]},
]

# Concrete actions for the recommended option (rendered as AI proposals until executed)
REALLOC_FROM, REALLOC_TO = "A07-R09-L02-P01", "A05-R02-L01-P03"
def action(i, kind, sku, qty, label, frm=None, to=None, shipment=None, dock=None):
    return {"id": f"ACT-{i}", "seq": i, "kind": kind, "sku": sku, "qty": qty, "label": label,
            "fromPositionId": frm, "toPositionId": to, "shipmentId": shipment, "dockId": dock}
options[0]["actions"] = [
    action(1, "reallocate", "MTR-7.5KW-IE3", 8, "Consolidate 8 motors at the JOB-4471 pick face", frm=REALLOC_FROM, to=REALLOC_TO),
    action(2, "inbound_putaway", "MTR-7.5KW-IE3", 25, "Put away Kestrel motors", to="A06-R05-L01-P01", shipment="SHP-90140", dock="D02"),
    action(3, "inbound_putaway", "MTR-7.5KW-IE3", 20, "Put away Kestrel motors", to="A06-R05-L01-P02", shipment="SHP-90140", dock="D02"),
    action(4, "inbound_putaway", "MTR-7.5KW-IE3", 20, "Put away Kestrel motors", to="A06-R05-L01-P03", shipment="SHP-90140", dock="D02"),
    action(5, "inbound_putaway", "STL-ASM-FRAME-220", 20, "Put away Ironbridge frames", to="A02-R03-L01-P01", shipment="SHP-90141", dock="D03"),
    action(6, "inbound_putaway", "STL-ASM-FRAME-220", 18, "Put away Ironbridge frames", to="A02-R03-L01-P02", shipment="SHP-90141", dock="D03"),
]
options[0]["impact"] = {"unitsMoved": 111, "skusProtected": 2, "jobsProtected": 3, "riskBefore": 0.82, "riskAfter": 0.18}

plan_ready = {"id": "PLN-0142-1", "disruptionId": DSR, "status": "awaiting_approval", "options": options,
              "recommendedOptionId": "OPT-A", "generatedAt": "@now", "allocations": []}

allocs = [
    {"id": "ALC-1", "optionId": "OPT-A", "sku": "MTR-7.5KW-IE3", "qty": 25, "destinationPositionId": "A06-R05-L01-P01", "status": "reserved"},
    {"id": "ALC-2", "optionId": "OPT-A", "sku": "MTR-7.5KW-IE3", "qty": 20, "destinationPositionId": "A06-R05-L01-P02", "status": "reserved"},
    {"id": "ALC-3", "optionId": "OPT-A", "sku": "MTR-7.5KW-IE3", "qty": 20, "destinationPositionId": "A06-R05-L01-P03", "status": "reserved"},
    {"id": "ALC-4", "optionId": "OPT-A", "sku": "STL-ASM-FRAME-220", "qty": 20, "destinationPositionId": "A02-R03-L01-P01", "status": "reserved"},
    {"id": "ALC-5", "optionId": "OPT-A", "sku": "STL-ASM-FRAME-220", "qty": 18, "destinationPositionId": "A02-R03-L01-P02", "status": "reserved"},
]
def alloc_status(st):
    return [{**a, "status": st} for a in allocs]

def incoming_lot(i, a, status, qty):
    s = SKU_MAP[a["sku"]]
    return {"type": "inventory.updated", "lot": {"lotId": f"LOT-RCV-{i}", "sku": a["sku"], "description": s[1],
            "positionId": a["destinationPositionId"], "qty": qty, "unit": s[2], "status": status,
            "reorderPoint": s[4], "lastUpdated": "@now", "source": "simulated"}}

shp_motor = {"id": "SHP-90140", "supplier": sup("SUP-KEST"), "vehicleType": "container_truck", "dockId": "D02",
             "status": "scheduled", "sku": "MTR-7.5KW-IE3", "qty": 65, "eta": "2026-10-29T10:00:00Z",
             "milestones": [{"label": "Scheduled", "at": None}, {"label": "At dock", "at": None},
                            {"label": "Unloaded", "at": None}, {"label": "Inspected", "at": None},
                            {"label": "Put away", "at": None}]}
shp_steel = {**shp_motor, "id": "SHP-90141", "supplier": sup("SUP-IRON"), "vehicleType": "trailer_truck",
             "dockId": "D03", "sku": "STL-ASM-FRAME-220", "qty": 38}

def shp(base, status, done):
    ms = [{"label": m["label"], "at": "@now" if i < done else None} for i, m in enumerate(base["milestones"])]
    return {"type": "shipment.status", "shipment": {**base, "status": status, "milestones": ms}}

def eq(eid, status, task):
    e = next(x for x in equipment if x["id"] == eid)
    return {"type": "equipment.task", "equipment": {**e, "status": status, "currentTask": task}}

def task(tid, kind, desc, frm=None, to=None, dock=None, zone=None):
    return {"id": tid, "kind": kind, "description": desc, "fromPositionId": frm, "toPositionId": to,
            "dockId": dock, "zoneId": zone}

steps = [
    {"id": "disruption", "label": "Supplier failure reported", "delayMs": 1500, "events": [
        {"type": "disruption.created", "disruption": disruption}],
     "audit": {"actor": "integration (supplier portal)", "action": "disruption.created", "entity": "disruption", "entityId": DSR,
               "detail": "Apex Motors force majeure notice ingested"}},
    {"id": "shortage", "label": "Shortage detection", "delayMs": 2500, "events": [
        run("RUN-1", "Inventory & BOM agent", "Reconciling on-hand stock against BOM demand", "running",
            ["Loaded 3 affected jobs requiring 100 x MTR-7.5KW-IE3"]),
        *restatus(motor_lots, "disruption_affected"), *restatus(steel_lots, "shortage"),
        run("RUN-1", "Inventory & BOM agent", "Shortage confirmed", "done",
            ["Loaded 3 affected jobs requiring 100 x MTR-7.5KW-IE3",
             "On hand: 35 across A05-R02-L01-P01, A05-R02-L01-P02, A07-R09-L02-P01 (gap 65)",
             "Dependent BOM line STL-ASM-FRAME-220: on hand 22 vs 60 required (gap 38)"]),
        {"type": "disruption.created", "disruption": {**disruption, "status": "analyzing"}}],
     "audit": {"actor": "agent:inventory_bom", "action": "shortage.detected", "entity": "disruption", "entityId": DSR,
               "detail": "Gap 65 x MTR-7.5KW-IE3, 38 x STL-ASM-FRAME-220"}},
    {"id": "impact", "label": "Job impact analysis", "delayMs": 2500, "events": [
        run("RUN-2", "Job impact agent", "Ranking affected jobs by deadline", "done",
            ["JOB-4471 Conveyor line retrofit: 60 pcs by 2026-11-06 (critical path)",
             "JOB-4478 Pump skid build: 25 pcs by 2026-11-10",
             "JOB-4490 Spares replenishment: 15 pcs by 2026-11-20 (deferrable)"])]},
    {"id": "sourcing", "label": "Supplier discovery & compatibility", "delayMs": 3000, "events": [
        run("RUN-3", "Supplier discovery agent", "Querying alternate suppliers", "done",
            ["4 suppliers carry an equivalent 7.5 kW B3 motor", "Kestrel: 140 in stock, 4-day lead time",
             "Northfield: 16-day lead time", "Volta: 25 in stock, B35 variant only"]),
        run("RUN-4", "Compatibility agent", "Datasheet comparison", "done",
            ["KD-7.5-B3 (Kestrel): frame 132S, shaft 38 mm, IE3: compatible",
             "NF-75-IE3 (Northfield): compatible", "VI-7.5-B35 (Volta): mount differs, adapter needed: unverified"])]},
    {"id": "recommendation", "label": "Recovery recommendation", "delayMs": 3000, "events": [
        run("RUN-5", "Quote risk agent", "Scoring cost, ETA and confidence", "done",
            ["3 options within budget of 68,000 USD", "2 options meet the 2026-11-06 deadline",
             "Recommended OPT-A: highest confidence among deadline-feasible options"]),
        {"type": "recovery.updated", "plan": plan_ready},
        {"type": "disruption.created", "disruption": {**disruption, "status": "awaiting_approval"}}],
     "audit": {"actor": "agent:recovery_planner", "action": "plan.proposed", "entity": "recovery_plan", "entityId": "PLN-0142-1",
               "detail": "3 options proposed; no purchase made (approval required)"}},
    {"id": "approval", "label": "Awaiting human approval", "delayMs": 0, "gate": "approval", "events": []},
    {"id": "dispatch", "label": "Purchase orders dispatched, trucks scheduled", "delayMs": 2500, "events": [
        {"type": "recovery.updated", "plan": {**plan_ready, "status": "approved", "allocations": alloc_status("reserved")}},
        *[incoming_lot(i, a, "incoming", 0) for i, a in enumerate(allocs)],
        shp(shp_motor, "scheduled", 1), shp(shp_steel, "scheduled", 1)]},
    {"id": "arriving", "label": "Trucks arriving", "delayMs": 3000, "events": [
        shp(shp_motor, "arriving", 1), shp(shp_steel, "arriving", 1)]},
    {"id": "at_dock", "label": "Trucks at dock", "delayMs": 3000, "events": [
        shp(shp_motor, "at_dock", 2), shp(shp_steel, "at_dock", 2),
        {"type": "dock.status", "dockId": "D02", "status": "occupied"},
        {"type": "dock.status", "dockId": "D03", "status": "occupied"}]},
    {"id": "unloading", "label": "Unloading", "delayMs": 3500, "events": [
        shp(shp_motor, "unloading", 2), shp(shp_steel, "unloading", 2),
        eq("FL-01", "active", task("TSK-1", "unload", "Unload SHP-90140 at Dock 2 to receiving lane", dock="D02")),
        eq("FL-02", "active", task("TSK-2", "unload", "Unload SHP-90141 at Dock 3 to receiving lane", dock="D03")),
        eq("CV-01", "active", task("TSK-3", "convey", "Carton flow to scanning station"))]},
    {"id": "inspection", "label": "Quality inspection", "delayMs": 3500, "events": [
        shp(shp_motor, "unloading", 3), shp(shp_steel, "unloading", 3),
        eq("FL-01", "idle", None), eq("FL-02", "idle", None), eq("CV-01", "idle", None),
        eq("TR-01", "active", task("TSK-4", "inspect", "Move samples to quality station", zone="Z-INS"))],
     "audit": {"actor": "qc.station (operator)", "action": "inspection.passed", "entity": "shipment", "entityId": "SHP-90140",
               "detail": "65/65 motors and 38/38 frames passed visual & nameplate check"}},
    {"id": "putaway", "label": "Putaway", "delayMs": 3500, "events": [
        shp(shp_motor, "departed", 4), shp(shp_steel, "departed", 4),
        {"type": "dock.status", "dockId": "D02", "status": "available"},
        {"type": "dock.status", "dockId": "D03", "status": "available"},
        eq("TR-01", "idle", None),
        eq("RT-01", "active", task("TSK-5", "putaway", "Put away 65 motors to A06-R05-L01", None, "A06-R05-L01-P01")),
        eq("FL-02", "active", task("TSK-6", "putaway", "Put away 38 frames to A02-R03-L01", None, "A02-R03-L01-P01")),
        eq("OP-01", "active", task("TSK-7", "reallocate", f"Consolidate 8 motors {REALLOC_FROM} to {REALLOC_TO}", REALLOC_FROM, REALLOC_TO))]},
    {"id": "inventory", "label": "Inventory updated after verified receipt", "delayMs": 3000, "events": [
        *[incoming_lot(i, a, "reserved", a["qty"]) for i, a in enumerate(allocs)],
        # The consolidated lot lands at its new position only with the verified receipt
        *[{"type": "inventory.updated", "lot": {**l, "status": "reserved",
            "positionId": REALLOC_TO if l["positionId"] == REALLOC_FROM else l["positionId"]}} for l in motor_lots],
        *restatus(steel_lots, "reserved"),
        shp(shp_motor, "departed", 5), shp(shp_steel, "departed", 5),
        eq("RT-01", "idle", None), eq("FL-02", "idle", None), eq("OP-01", "idle", None),
        {"type": "recovery.updated", "plan": {**plan_ready, "status": "approved", "allocations": alloc_status("put_away")}},
        {"type": "disruption.created", "disruption": {**disruption, "status": "resolved", "availableQty": 100}}],
     "audit": {"actor": "wms (receipt verification)", "action": "receipt.verified", "entity": "disruption", "entityId": DSR,
               "detail": "100/100 MTR-7.5KW-IE3 and 60/60 STL-ASM-FRAME-220 now allocated to affected jobs"}},
]

scenario = {
    "id": "motor-component-shortage", "title": "Critical motor component supplier failure",
    "description": "Apex Motors cannot deliver 7.5 kW motors (required 100, on hand 35) with a dependent steel frame shortage. Runs disruption → detection → agent analysis → recommendation → approval → truck arrival → unloading → inspection → putaway → inventory update.",
    "simulated": True,
    "initialState": {"layout": layout, "inventory": inventory, "shipments": shipments, "equipment": equipment,
                     "audit": audit, "disruptions": [], "recovery": []},
    "steps": steps,
}
with open(out_path, "w") as f:
    json.dump(scenario, f, separators=(",", ":"))
print(f"racks={len(racks)} positions={sum(r['levels']*r['positionsPerLevel'] for r in racks)} lots={len(inventory)} steps={len(steps)}")
