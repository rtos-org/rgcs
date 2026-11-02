//! Survey cameras: the shared list of cameras a photogrammetry survey is planned with.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const MAX_SURVEY_CAMERA_NAME: usize = 80;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurveyCamera {
    #[ts(type = "number | null")]
    pub id: Option<i64>,
    pub name: String,
    pub sensor_w_mm: f32,
    pub sensor_h_mm: f32,
    pub image_w_px: u32,
    pub image_h_px: u32,
    pub focal_mm: f32,
    /// Shutter time in seconds (1/1000 s = 0.001).
    pub shutter_s: f32,
    pub min_interval_s: f32,
    pub builtin: bool,
}

fn positive(name: &str, v: f32) -> Result<(), String> {
    if v.is_finite() && v > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be a positive number"))
    }
}

pub fn validate_survey_camera(c: &SurveyCamera) -> Result<(), String> {
    let name_len = c.name.chars().count();
    if name_len == 0 || name_len > MAX_SURVEY_CAMERA_NAME {
        return Err(format!(
            "camera name must be 1-{MAX_SURVEY_CAMERA_NAME} characters"
        ));
    }
    positive("sensor_w_mm", c.sensor_w_mm)?;
    positive("sensor_h_mm", c.sensor_h_mm)?;
    positive("focal_mm", c.focal_mm)?;
    positive("shutter_s", c.shutter_s)?;
    positive("min_interval_s", c.min_interval_s)?;
    if c.shutter_s > 1.0 {
        return Err("shutter_s must be at most 1 second".into());
    }
    if c.image_w_px == 0 || c.image_h_px == 0 {
        return Err("image size must be positive".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn camera() -> SurveyCamera {
        SurveyCamera {
            id: None,
            name: "cam".into(),
            sensor_w_mm: 35.7,
            sensor_h_mm: 23.8,
            image_w_px: 9504,
            image_h_px: 6336,
            focal_mm: 35.0,
            shutter_s: 0.001,
            min_interval_s: 1.0,
            builtin: false,
        }
    }

    #[test]
    fn validate_rejects_bad_names_and_non_positive_numbers() {
        assert!(validate_survey_camera(&camera()).is_ok());
        let mut c = camera();
        c.name = String::new();
        assert!(validate_survey_camera(&c).is_err());
        c.name = "x".repeat(81);
        assert!(validate_survey_camera(&c).is_err());
        for f in [
            |c: &mut SurveyCamera| c.focal_mm = 0.0,
            |c: &mut SurveyCamera| c.sensor_w_mm = -1.0,
            |c: &mut SurveyCamera| c.sensor_h_mm = f32::NAN,
            |c: &mut SurveyCamera| c.min_interval_s = f32::INFINITY,
            |c: &mut SurveyCamera| c.shutter_s = 1.5,
            |c: &mut SurveyCamera| c.image_w_px = 0,
            |c: &mut SurveyCamera| c.image_h_px = 0,
        ] {
            let mut c = camera();
            f(&mut c);
            assert!(validate_survey_camera(&c).is_err());
        }
    }
}
