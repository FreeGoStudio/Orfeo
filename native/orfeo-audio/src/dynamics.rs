//! Master compressor and Auto-Level, rebuilt without look-ahead. The Web Audio
//! DynamicsCompressorNode delays everything by 6 ms to see peaks coming; here
//! nothing is delayed — the soft clip after this catches what the attack misses.

/// Same five positions as the Web Audio engine's COMPRESSOR_PRESETS
#[derive(Clone, Copy, Debug)]
pub struct CompPreset { pub threshold_db: f32, pub ratio: f32, pub attack_s: f32, pub knee_db: f32, pub makeup_db: f32 }

pub const PRESETS: [CompPreset; 5] = [
    CompPreset { threshold_db: -1.0,  ratio: 2.0,  attack_s: 0.010, knee_db: 10.0, makeup_db: 0.5 }, // Safety
    CompPreset { threshold_db: -6.0,  ratio: 4.0,  attack_s: 0.008, knee_db: 8.0,  makeup_db: 1.5 }, // Gentle
    CompPreset { threshold_db: -12.0, ratio: 8.0,  attack_s: 0.005, knee_db: 6.0,  makeup_db: 3.0 }, // Medium
    CompPreset { threshold_db: -18.0, ratio: 14.0, attack_s: 0.003, knee_db: 3.0,  makeup_db: 4.5 }, // Firm
    CompPreset { threshold_db: -24.0, ratio: 20.0, attack_s: 0.003, knee_db: 0.0,  makeup_db: 6.0 }, // Limiter
];
const RELEASE_S: f32 = 0.25;

#[inline] fn db_to_gain(db: f32) -> f32 { 10f32.powf(db / 20.0) }
#[inline] fn gain_to_db(g: f32) -> f32 { 20.0 * g.max(1e-9).log10() }

/// Stereo-linked peak compressor with a soft knee
pub struct Compressor {
    rate: f32,
    pub enabled: bool,
    p: CompPreset,
    att: f32, rel: f32,
    /// Current gain reduction in dB (≤ 0)
    pub reduction_db: f32,
}

impl Compressor {
    pub fn new(rate: f32) -> Self {
        let mut c = Compressor { rate, enabled: false, p: PRESETS[0], att: 0.0, rel: 0.0, reduction_db: 0.0 };
        c.set(false, 0);
        c
    }
    pub fn set(&mut self, enabled: bool, preset: usize) {
        self.enabled = enabled;
        self.p = PRESETS[preset.min(PRESETS.len() - 1)];
        self.att = (-1.0 / (self.p.attack_s * self.rate)).exp();
        self.rel = (-1.0 / (RELEASE_S * self.rate)).exp();
    }
    #[inline]
    fn curve(&self, x_db: f32) -> f32 {
        // Output level for an input level (dB), soft knee around the threshold
        let (t, r, w) = (self.p.threshold_db, self.p.ratio, self.p.knee_db);
        let d = x_db - t;
        if w > 0.0 && 2.0 * d.abs() <= w { x_db + (1.0 / r - 1.0) * (d + w / 2.0).powi(2) / (2.0 * w) }
        else if 2.0 * d > w { t + d / r }
        else { x_db }
    }
    /// Processes one stereo frame in place (makeup gain applied before, as in the Web Audio chain)
    #[inline]
    pub fn process(&mut self, l: &mut f32, r: &mut f32) {
        if !self.enabled { self.reduction_db = 0.0; return }
        let mk = db_to_gain(self.p.makeup_db);
        *l *= mk; *r *= mk;
        let x_db = gain_to_db(l.abs().max(r.abs()));
        let target = (self.curve(x_db) - x_db).min(0.0);
        let coef = if target < self.reduction_db { self.att } else { self.rel };
        self.reduction_db = target + coef * (self.reduction_db - target);
        let g = db_to_gain(self.reduction_db);
        *l *= g; *r *= g;
    }
}

/// Auto-Level: slow closed-loop gain toward a target loudness, for whole-song
/// drift (a quiet passage), never for single notes — same constants as the
/// Web Audio engine. Active only while the compressor is on.
pub struct AutoLevel {
    rate: f32,
    pub gain: f32,
    target_gain: f32,
    sum_sq: f64,
    count: usize,
    window: usize,
}

const AGC_TARGET_DB: f32 = -18.0;
const AGC_NOISE_FLOOR_DB: f32 = -50.0;
const AGC_MAX_BOOST_DB: f32 = 9.0;
const AGC_MAX_CUT_DB: f32 = 4.0;
const AGC_TC_UP_S: f32 = 3.0;
const AGC_TC_DOWN_S: f32 = 5.0;

impl AutoLevel {
    pub fn new(rate: f32) -> Self {
        AutoLevel { rate, gain: 1.0, target_gain: 1.0, sum_sq: 0.0, count: 0, window: (rate * 0.1) as usize }
    }
    #[inline]
    pub fn process(&mut self, active: bool, l: &mut f32, r: &mut f32) {
        // measure (post-gain, like the Web Audio analyser)
        *l *= self.gain; *r *= self.gain;
        self.sum_sq += (*l as f64).powi(2) + (*r as f64).powi(2);
        self.count += 1;
        if self.count >= self.window {
            let rms = (self.sum_sq / (2 * self.count) as f64).sqrt() as f32;
            self.sum_sq = 0.0; self.count = 0;
            if !active { self.target_gain = 1.0 }
            else if rms > 0.0 {
                let rms_db = gain_to_db(rms);
                if rms_db >= AGC_NOISE_FLOOR_DB {
                    // correction relative to the signal before this stage's gain
                    let correction = (AGC_TARGET_DB - (rms_db - gain_to_db(self.gain))).clamp(-AGC_MAX_CUT_DB, AGC_MAX_BOOST_DB);
                    self.target_gain = db_to_gain(correction);
                }
            }
        }
        let tc = if self.target_gain > self.gain { AGC_TC_UP_S } else { AGC_TC_DOWN_S };
        let k = 1.0 - (-1.0 / (tc * self.rate)).exp();
        self.gain += (self.target_gain - self.gain) * k;
    }
}
