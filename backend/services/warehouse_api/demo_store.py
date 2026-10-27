"""SQLite-backed demo data: suppliers, inventory, deliveries, communications.

Tables live in the same SQLite file as the case repository. They are created
and seeded once (idempotently) from ``demo_seed``; every API call then reads
the database, so edits to the rows are reflected immediately.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from . import demo_seed

_TABLES: dict[str, tuple[str, list[dict[str, Any]]]] = {
    "demo_suppliers": ("supplier_id", demo_seed.SUPPLIERS),
    "demo_inventory": ("sku", demo_seed.INVENTORY),
    "demo_deliveries": ("delivery_id", demo_seed.DELIVERIES),
    "demo_communications": ("comm_id", demo_seed.COMMUNICATIONS),
}

_lock = threading.Lock()


class DemoStore:
    def __init__(self, database_path: str) -> None:
        self.path = database_path
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        self._ensure()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure(self) -> None:
        with _lock, self._connect() as conn:
            for table, (key, rows) in _TABLES.items():
                conn.execute(
                    f"CREATE TABLE IF NOT EXISTS {table} ("
                    f"{key} TEXT PRIMARY KEY, position INTEGER NOT NULL, payload TEXT NOT NULL)"
                )
                # Seed missing rows only, so local edits survive restarts
                for pos, row in enumerate(rows):
                    conn.execute(
                        f"INSERT OR IGNORE INTO {table} ({key}, position, payload) VALUES (?, ?, ?)",
                        (row[key], pos, json.dumps(row)),
                    )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS demo_simulation_cases (case_id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )
            case = demo_seed.SIMULATION_CASE
            conn.execute(
                "INSERT OR REPLACE INTO demo_simulation_cases (case_id, payload) VALUES (?, ?)",
                (case["case_id"], json.dumps(case)),
            )

    def _list(self, table: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(f"SELECT payload FROM {table} ORDER BY position").fetchall()
        return [json.loads(r["payload"]) for r in rows]

    def suppliers(self) -> list[dict[str, Any]]:
        return self._list("demo_suppliers")

    def inventory(self) -> list[dict[str, Any]]:
        return self._list("demo_inventory")

    def deliveries(self) -> list[dict[str, Any]]:
        return self._list("demo_deliveries")

    def communications(self) -> list[dict[str, Any]]:
        return self._list("demo_communications")

    def simulation_case(self, case_id: str) -> dict[str, Any] | None:
        """The simulation fixture, joined with live supplier and inventory rows."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload FROM demo_simulation_cases WHERE case_id = ?", (case_id,)
            ).fetchone()
        if row is None:
            return None
        case = json.loads(row["payload"])
        suppliers = {s["supplier_id"]: s for s in self.suppliers()}
        item = next((i for i in self.inventory() if i["sku"] == case["component"]["sku"]), None)
        case["inventory_item"] = item
        case["suppliers"] = [suppliers[sid] for sid in case["supplier_ids"] if sid in suppliers]
        for quote in case["quotes"]:
            supplier = suppliers.get(quote["supplier_id"])
            quote["supplier_name"] = supplier["name"] if supplier else quote["supplier_id"]
        case["catalog_supplier_count"] = len(suppliers)
        case["data_source"] = "simulation fixture joined with demo database rows (SIMULATED)"
        return case

    def simulation_cases(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT case_id FROM demo_simulation_cases ORDER BY case_id").fetchall()
        return [c for c in (self.simulation_case(r["case_id"]) for r in rows) if c]
