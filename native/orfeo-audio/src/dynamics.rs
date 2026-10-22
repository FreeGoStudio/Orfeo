//! Master compressor, safety limiter and Auto-Level, built to sound like the
//! Samples engine's Web Audio chain: the same static curve and automatic
//! make-up gain as the browser's DynamicsCompressorNode (Chromium's
//! DynamicsCompressorKernel), the same always-on safety limiter after it, and
//! the same Auto-Level loop. One difference on purpose: no 6 ms look-ahead —
//! nothing is delayed; the soft clip after this catches what the attack misses.

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
/// The Web Audio chain's fixed last stage, always on (useSamplesEngine.ts)
const SAFETY: CompPreset = CompPreset { threshold_db: -1.0, ratio: 20.0, attack_s: 0.001, knee_db: 0.0, makeup_db: 0.0 };
const SAFETY_RELEASE_S: f32 = 0.05;

#[inline] fn db_to_gain(db: f32) -> f32 { 10f32.powf(db / 20.0) }
#[inline] fn gain_to_db(g: f32) -> f32 { 20.0 * g.max(1e-9).log10() }

/// The browser compressor's static curve: an exponential knee from the
/// threshold up to threshold + knee, a constant ratio above it, and the
/// automatic make-up gain it applies on top (Chromium: (1 / gain at 0 dBFS)^0.6)
#[derive(Clone, Copy)]
struct Curve { lin_thr: f32, k: f32, knee_thr: f32, knee_thr_db: f32, y_knee_thr_db: f32, slope: f32, makeup: f32 }

impl Curve {
    fn new(threshold_db: f32, knee_db: f32, ratio: f32) -> Curve {
        let mut c = Curve { lin_thr: db_to_gain(threshold_db), k: 5.0, knee_thr: 0.0, knee_thr_db: 0.0, y_knee_thr_db: 0.0, slope: 1.0 / ratio, makeup: 1.0 };
        // k: the knee's sharpness, so the slope at the knee's top equals 1 / ratio
        let x = db_to_gain(threshold_db + knee_db);
        let (mut lo, mut hi, mut k) = (0.1f32, 10000f32, 5f32);
        for _ in 0..15 {
            if c.slope_at(x, k) < c.slope { hi = k } else { lo = k }
            k = (lo * hi).sqrt();
        }
        c.k = k;
        c.knee_thr = x;
        c.knee_thr_db = gain_to_db(x);
        c.y_knee_thr_db = gain_to_db(c.knee_curve(x, k));
        c.makeup = (1.0 / c.saturate(1.0)).powf(0.6);
        c
    }
    fn knee_curve(&self, x: f32, k: f32) -> f32 {
        if x < self.lin_thr { x } else { self.lin_thr + (1.0 - (-k * (x - self.lin_thr)).exp()) / k }
    }
    fn slope_at(&self, x: f32, k: f32) -> f32 {
        if x < self.lin_thr { return 1.0 }
        let x2 = x * 1.001;
        (gain_to_db(self.knee_curve(x2, k)) - gain_to_db(self.knee_curve(x, k))) / (gain_to_db(x2) - gain_to_db(x))
    }
    /// Output level for an input level (linear)
    fn saturate(&self, x: f32) -> f32 {
        if x < self.knee_thr { self.knee_curve(x, self.k) }
        else { db_to_gain(self.y_knee_thr_db + self.slope * (gain_to_db(x) - self.knee_thr_db)) }
    }
}

/// Stereo-linked peak compressor on the browser's curve
pub struct Compressor {
    rate: f32,
    pub enabled: bool,
    p: CompPreset,
    curve: Curve,
    release_s: f32,
    att: f32, rel: f32,
    /// Current gain reduction in dB (≤ 0)
    pub reduction_db: f32,
}

impl Compressor {
    pub fn new(rate: f32) -> Self {
        let mut c = Compressor { rate, enabled: false, p: PRESETS[0], curve: Curve::new(0.0, 0.0, 1.0), release_s: RELEASE_S, att: 0.0, rel: 0.0, reduction_db: 0.0 };
        c.set(false, 0);
        c
    }
    /// The always-on safety limiter that ends the song bus
    pub fn safety(rate: f32) -> Self {
        let mut c = Compressor::new(rate);
        c.release_s = SAFETY_RELEASE_S;
        c.apply(true, SAFETY);
        c
    }
    pub fn set(&mut self, enabled: bool, preset: usize) { self.apply(enabled, PRESETS[preset.min(PRESETS.len() - 1)]) }
    fn apply(&mut self, enabled: bool, p: CompPreset) {
        self.enabled = enabled;
        self.p = p;
        self.curve = Curve::new(p.threshold_db, p.knee_db, p.ratio);
        self.att = (-1.0 / (p.attack_s * self.rate)).exp();
        self.rel = (-1.0 / (self.release_s * self.rate)).exp();
    }
    /// Processes one stereo frame in place: Orfeo's make-up gain first (as in
    /// the Web Audio chain), then the compression, then the curve's own make-up
    #[inline]
    pub fn process(&mut self, l: &mut f32, r: &mut f32) {
        if !self.enabled { self.reduction_db = 0.0; return }
        let mk = db_to_gain(self.p.makeup_db);
        *l *= mk; *r *= mk;
        let x = l.abs().max(r.abs());
        let target = if x > 1e-6 { gain_to_db(self.curve.saturate(x) / x).min(0.0) } else { 0.0 };
        let coef = if target < self.reduction_db { self.att } else { self.rel };
        self.reduction_db = target + coef * (self.reduction_db - target);
        let g = db_to_gain(self.reduction_db) * self.curve.makeup;
        *l *= g; *r *= g;
    }
}

/// Auto-Level: slow closed-loop gain toward a target loudness, for whole-song
/// drift (a quiet passage), never for single notes. Measured exactly as the
/// Web Audio engine does: every 100 ms, the RMS of the last 2048 samples of the
/// mono mix after this stage's own gain. Active only while the compressor is on.
pub struct AutoLevel {
    rate: f32,
    pub gain: f32,
    target_gain: f32,
    ring: Vec<f32>,
    at: usize,
    count: usize,
    poll: usize,
}

const AGC_TARGET_DB: f32 = -18.0;
const AGC_NOISE_FLOOR_DB: f32 = -50.0;
const AGC_MAX_BOOST_DB: f32 = 9.0;
const AGC_MAX_CUT_DB: f32 = 4.0;
const AGC_TC_UP_S: f32 = 3.0;
const AGC_TC_DOWN_S: f32 = 5.0;
const AGC_WINDOW: usize = 2048;

impl AutoLevel {
    pub fn new(rate: f32) -> Self {
        AutoLevel { rate, gain: 1.0, target_gain: 1.0, ring: vec![0.0; AGC_WINDOW], at: 0, count: 0, poll: (rate * 0.1) as usize }
    }
    #[inline]
    pub fn process(&mut self, active: bool, l: &mut f32, r: &mut f32) {
        *l *= self.gain; *r *= self.gain;
        self.ring[self.at] = (*l + *r) * 0.5;
        self.at = (self.at + 1) % AGC_WINDOW;
        self.count += 1;
        if self.count >= self.poll {
            self.count = 0;
            if !active { self.target_gain = 1.0 }
            else {
                let rms = (self.ring.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / AGC_WINDOW as f64).sqrt() as f32;
                if rms > 0.0 {
                    let rms_db = gain_to_db(rms);
                    if rms_db >= AGC_NOISE_FLOOR_DB {
                        self.target_gain = db_to_gain((AGC_TARGET_DB - rms_db).clamp(-AGC_MAX_CUT_DB, AGC_MAX_BOOST_DB));
                    }
                }
            }
        }
        let tc = if self.target_gain > self.gain { AGC_TC_UP_S } else { AGC_TC_DOWN_S };
        let k = 1.0 - (-1.0 / (tc * self.rate)).exp();
        self.gain += (self.target_gain - self.gain) * k;
    }
}

/// The song bus's last stage: a look-ahead brickwall limiter. The audio is
/// delayed by a couple of milliseconds so every peak is seen coming, and the
/// gain eases down just enough before it, so the output never goes above the
/// ceiling on any sound card, at any volume. No clipping: it only turns down,
/// smoothly, and comes back up over the release time.
///
/// Gain needed per sample t = min(1, ceiling / peak); a sliding minimum of t
/// over L samples, a release that lets it rise only slowly, then a moving
/// average over L samples. Every value averaged is at most t of the sample
/// L-1 back, which is the one leaving the delay line now — so the ceiling
/// holds exactly, and the averaging turns each gain change into a ramp.
pub struct Brickwall {
    ceiling: f32,
    len: usize,
    delay: Vec<(f32, f32)>,
    at: usize,
    // sliding minimum of the needed gain: (sample index, gain), increasing gains
    mins: std::collections::VecDeque<(u64, f32)>,
    n: u64,
    released: f32,
    rel: f32,
    avg: Vec<f32>,
    avg_at: usize,
    avg_sum: f64,
    /// Current gain reduction in dB (<= 0)
    pub reduction_db: f32,
}

impl Brickwall {
    pub fn new(rate: f32, ceiling_db: f32, lookahead_s: f32, release_s: f32) -> Self {
        let len = ((rate * lookahead_s) as usize).max(2);
        Brickwall {
            ceiling: db_to_gain(ceiling_db), len,
            delay: vec![(0.0, 0.0); len - 1], at: 0,
            mins: std::collections::VecDeque::with_capacity(len + 1), n: 0,
            released: 1.0, rel: 1.0 - (-1.0 / (release_s * rate)).exp(),
            avg: vec![1.0; len], avg_at: 0, avg_sum: len as f64,
            reduction_db: 0.0,
        }
    }
    /// How far the audio is held back, in samples
    pub fn latency(&self) -> usize { self.len - 1 }

    #[inline]
    pub fn process(&mut self, l: &mut f32, r: &mut f32) {
        let peak = l.abs().max(r.abs());
        let need = if peak > self.ceiling { self.ceiling / peak } else { 1.0 };
        // sliding minimum over the last `len` samples
        while self.mins.back().map_or(false, |&(_, g)| g >= need) { self.mins.pop_back(); }
        self.mins.push_back((self.n, need));
        while self.mins.front().map_or(false, |&(i, _)| i + self.len as u64 <= self.n) { self.mins.pop_front(); }
        self.n += 1;
        let held = self.mins.front().map_or(1.0, |&(_, g)| g);
        // release: rise slowly, fall at once
        self.released = if held < self.released { held } else { self.released + (held - self.released) * self.rel };
        // moving average over `len` samples
        self.avg_sum += (self.released - self.avg[self.avg_at]) as f64;
        self.avg[self.avg_at] = self.released;
        self.avg_at = (self.avg_at + 1) % self.len;
        let g = (self.avg_sum / self.len as f64) as f32;
        // delay line
        let (dl, dr) = std::mem::replace(&mut self.delay[self.at], (*l, *r));
        self.at = (self.at + 1) % self.delay.len();
        *l = dl * g; *r = dr * g;
        self.reduction_db = gain_to_db(g).min(0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn makeup_matches_the_browser() {
        // Gentle: about +1.2 dB of automatic make-up; the safety limiter about +0.6 dB
        let g = Curve::new(-6.0, 8.0, 4.0);
        let s = Curve::new(-1.0, 0.0, 20.0);
        let (gd, sd) = (gain_to_db(g.makeup), gain_to_db(s.makeup));
        assert!(gd > 1.0 && gd < 1.5, "gentle makeup {gd}");
        assert!(sd > 0.3 && sd < 0.9, "safety makeup {sd}");
        // below the threshold nothing changes
        assert!((g.saturate(0.1) - 0.1).abs() < 1e-6);
    }

    #[test]
    fn brickwall_never_passes_the_ceiling() {
        let rate = 48_000.0;
        let mut lim = Brickwall::new(rate, -1.0, 0.002, 0.08);
        let ceiling = db_to_gain(-1.0);
        // noise with sudden bursts up to +12 dB over full scale, single-sample spikes included
        let mut seed = 12345u32;
        let mut rnd = || { seed = seed.wrapping_mul(1664525).wrapping_add(1013904223); (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0 };
        let mut worst = 0f32;
        let mut input = Vec::new();
        let mut output = Vec::new();
        for i in 0..rate as usize * 4 {
            let level = match (i / 4800) % 5 { 0 => 0.3, 1 => 1.0, 2 => 2.5, 3 => 4.0, _ => 0.05 };
            let spike = if i % 9973 == 0 { 3.5 } else { 1.0 };
            let (mut l, mut r) = (rnd() * level * spike, rnd() * level);
            input.push(l);
            lim.process(&mut l, &mut r);
            output.push(l);
            worst = worst.max(l.abs()).max(r.abs());
        }
        assert!(worst <= ceiling * 1.0001, "peak {worst} over ceiling {ceiling}");
        // quiet audio passes untouched, just delayed
        let mut quiet = Brickwall::new(rate, -1.0, 0.002, 0.08);
        let d = quiet.latency();
        let xs: Vec<f32> = (0..2000).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
        let ys: Vec<f32> = xs.iter().map(|&x| { let (mut a, mut b) = (x, x); quiet.process(&mut a, &mut b); a }).collect();
        for i in d..2000 { assert!((ys[i] - xs[i - d]).abs() < 1e-6, "sample {i}") }
        let _ = (input, output);
    }
}
