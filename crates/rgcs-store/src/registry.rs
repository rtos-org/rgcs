//! Vehicle registry (無人航空機の概要) on the `vehicles` table and pilot
//! info on `users` (migration `0004_logbook.sql`).

use rgcs_core::{PilotInfo, PilotInput, SysId, VehicleRegistry, VehicleRegistryInput};
use sqlx::Row;

use crate::{now_iso, Result, Store};

fn row_to_registry(sysid: SysId, r: &sqlx::sqlite::SqliteRow, total: u32) -> VehicleRegistry {
    VehicleRegistry {
        sysid,
        name: r.get("name"),
        registration: r.get("registration"),
        uas_type: r.get("uas_type"),
        model: r.get("model"),
        type_cert_no: r.get("type_cert_no"),
        airworthiness_class: r.get("airworthiness_class"),
        airworthiness_no: r.get("airworthiness_no"),
        manufacturer: r.get("manufacturer"),
        serial_no: r.get("serial_no"),
        initial_flight_minutes: r.get::<i64, _>("initial_flight_minutes").max(0) as u32,
        inspection_template_id: r.get("inspection_template_id"),
        endurance_minutes: r
            .get::<Option<i64>, _>("endurance_minutes")
            .map(|m| m.max(0) as u32),
        total_flight_minutes: total,
    }
}

fn defaults(sysid: SysId, live_name: &str) -> VehicleRegistry {
    VehicleRegistry {
        sysid,
        name: live_name.to_string(),
        registration: String::new(),
        uas_type: String::new(),
        model: String::new(),
        type_cert_no: String::new(),
        airworthiness_class: String::new(),
        airworthiness_no: String::new(),
        manufacturer: String::new(),
        serial_no: String::new(),
        initial_flight_minutes: 0,
        inspection_template_id: None,
        endurance_minutes: None,
        total_flight_minutes: 0,
    }
}

impl Store {
    /// The registry row for `sysid`, or defaults named after the live vehicle.
    pub async fn registry(&self, sysid: SysId, live_name: &str) -> Result<VehicleRegistry> {
        let row = sqlx::query(
            "SELECT name, registration, uas_type, model, type_cert_no, airworthiness_class, airworthiness_no, \
             manufacturer, serial_no, initial_flight_minutes, inspection_template_id, endurance_minutes FROM vehicles WHERE sysid = ?1",
        )
            .bind(i64::from(sysid))
            .fetch_optional(&self.pool)
            .await?;
        let total = self.total_flight_minutes(sysid).await?;
        Ok(match row {
            Some(r) => row_to_registry(sysid, &r, total),
            None => VehicleRegistry {
                total_flight_minutes: total,
                ..defaults(sysid, live_name)
            },
        })
    }

    /// Upsert; `live_kind` fills the NOT NULL `kind` column on first insert.
    pub async fn put_registry(
        &self,
        sysid: SysId,
        input: &VehicleRegistryInput,
        live_kind: &str,
    ) -> Result<VehicleRegistry> {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO vehicles (sysid, name, kind, first_seen, last_seen, registration, uas_type, model, \
             type_cert_no, airworthiness_class, airworthiness_no, manufacturer, serial_no, \
             initial_flight_minutes, inspection_template_id, endurance_minutes) \
             VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) \
             ON CONFLICT(sysid) DO UPDATE SET name = excluded.name, registration = excluded.registration, \
             uas_type = excluded.uas_type, model = excluded.model, type_cert_no = excluded.type_cert_no, \
             airworthiness_class = excluded.airworthiness_class, airworthiness_no = excluded.airworthiness_no, \
             manufacturer = excluded.manufacturer, serial_no = excluded.serial_no, \
             initial_flight_minutes = excluded.initial_flight_minutes, \
             inspection_template_id = excluded.inspection_template_id, \
             endurance_minutes = excluded.endurance_minutes, last_seen = excluded.last_seen",
        )
        .bind(i64::from(sysid))
        .bind(&input.name)
        .bind(live_kind)
        .bind(&now)
        .bind(&input.registration)
        .bind(&input.uas_type)
        .bind(&input.model)
        .bind(&input.type_cert_no)
        .bind(&input.airworthiness_class)
        .bind(&input.airworthiness_no)
        .bind(&input.manufacturer)
        .bind(&input.serial_no)
        .bind(i64::from(input.initial_flight_minutes))
        .bind(input.inspection_template_id)
        .bind(input.endurance_minutes.map(i64::from))
        .execute(&self.pool)
        .await?;
        self.registry(sysid, &input.name).await
    }

    /// Minutes to add to every flight total: the registry's initial value (0 without a row).
    pub(crate) async fn initial_flight_minutes(&self, sysid: SysId) -> Result<u32> {
        let v: Option<i64> =
            sqlx::query_scalar("SELECT initial_flight_minutes FROM vehicles WHERE sysid = ?1")
                .bind(i64::from(sysid))
                .fetch_optional(&self.pool)
                .await?;
        Ok(v.unwrap_or(0).max(0) as u32)
    }

    pub async fn pilot(&self, username: &str) -> Result<Option<PilotInfo>> {
        let row = sqlx::query("SELECT username, full_name, license_no FROM users WHERE username = ?1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| PilotInfo {
            username: r.get("username"),
            full_name: r.get("full_name"),
            license_no: r.get("license_no"),
        }))
    }

    /// False when the user does not exist.
    pub async fn put_pilot(&self, username: &str, input: &PilotInput) -> Result<bool> {
        let res = sqlx::query("UPDATE users SET full_name = ?2, license_no = ?3 WHERE username = ?1")
            .bind(username)
            .bind(&input.full_name)
            .bind(&input.license_no)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{PilotInput, VehicleRegistryInput};

    use crate::Store;

    #[tokio::test]
    async fn registry_defaults_then_round_trips() {
        let s = Store::open_memory().await.unwrap();
        let r = s.registry(7, "UAV-07").await.unwrap();
        assert_eq!(
            (
                r.name.as_str(),
                r.registration.as_str(),
                r.initial_flight_minutes,
                r.inspection_template_id
            ),
            ("UAV-07", "", 0, None)
        );
        let input = VehicleRegistryInput {
            name: "Demo copter".into(),
            registration: "JU1234567890".into(),
            uas_type: "回転翼航空機(マルチローター)".into(),
            model: "X-500".into(),
            type_cert_no: "".into(),
            airworthiness_class: "第二種".into(),
            airworthiness_no: "AW-001".into(),
            manufacturer: "RTOS".into(),
            serial_no: "SN-0001".into(),
            initial_flight_minutes: 125,
            inspection_template_id: Some(1),
            endurance_minutes: None,
        };
        let w = s.put_registry(7, &input, "copter").await.unwrap();
        assert_eq!(
            (
                w.registration.as_str(),
                w.initial_flight_minutes,
                w.total_flight_minutes
            ),
            ("JU1234567890", 125, 125)
        );
        assert_eq!(s.registry(7, "x").await.unwrap().name, "Demo copter");
    }

    #[tokio::test]
    async fn pilot_info_is_per_user() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(s.pilot("admin").await.unwrap().unwrap().full_name, "");
        assert!(s
            .put_pilot(
                "admin",
                &PilotInput {
                    full_name: "山田".into(),
                    license_no: "T123".into()
                }
            )
            .await
            .unwrap());
        assert!(!s
            .put_pilot(
                "nobody",
                &PilotInput {
                    full_name: "".into(),
                    license_no: "".into()
                }
            )
            .await
            .unwrap());
        assert_eq!(s.pilot("admin").await.unwrap().unwrap().license_no, "T123");
    }

    #[tokio::test]
    async fn registry_keeps_endurance() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(s.registry(3, "UAV-03").await.unwrap().endurance_minutes, None);
        let input = VehicleRegistryInput {
            name: "E".into(),
            registration: "".into(),
            uas_type: "".into(),
            model: "".into(),
            type_cert_no: "".into(),
            airworthiness_class: "".into(),
            airworthiness_no: "".into(),
            manufacturer: "".into(),
            serial_no: "".into(),
            initial_flight_minutes: 0,
            inspection_template_id: None,
            endurance_minutes: Some(25),
        };
        let w = s.put_registry(3, &input, "copter").await.unwrap();
        assert_eq!(w.endurance_minutes, Some(25));
        assert_eq!(s.registry(3, "x").await.unwrap().endurance_minutes, Some(25));
    }
}
