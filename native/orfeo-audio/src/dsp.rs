//! Master-chain pieces that add no delay. (Look-ahead compression is what cost
//! 12 ms in the Web Audio chain; nothing here looks ahead.)

/// Emergency stage only: linear up to 0.95 (above the song's -1 dBFS ceiling,
/// so the song never touches it), then a smooth knee to 1.0 — catches your own
/// keys played hard on top of an already-loud song, never a hard clip.
#[inline]
pub fn soft_clip(x: f32) -> f32 {
    const KNEE: f32 = 0.95;
    let a = x.abs();
    if a <= KNEE { x } else { x.signum() * (KNEE + (1.0 - KNEE) * ((a - KNEE) / (1.0 - KNEE)).tanh()) }
}

/// High-shelf biquad (RBJ cookbook) — the master Tone knob, ±12 dB at 3 kHz
pub struct HighShelf { b0: f32, b1: f32, b2: f32, a1: f32, a2: f32, z: [[f32; 2]; 2] }

impl HighShelf {
    pub fn new(rate: f32, freq: f32, gain_db: f32) -> Self {
        let mut s = HighShelf { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z: [[0.0; 2]; 2] };
        s.set(rate, freq, gain_db);
        s
    }
    pub fn set(&mut self, rate: f32, freq: f32, gain_db: f32) {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let (cw, sw) = (w0.cos(), w0.sin());
        let alpha = sw / 2.0 * std::f32::consts::SQRT_2;
        let sa = 2.0 * a.sqrt() * alpha;
        let a0 = (a + 1.0) - (a - 1.0) * cw + sa;
        self.b0 = a * ((a + 1.0) + (a - 1.0) * cw + sa) / a0;
        self.b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cw) / a0;
        self.b2 = a * ((a + 1.0) + (a - 1.0) * cw - sa) / a0;
        self.a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cw) / a0;
        self.a2 = ((a + 1.0) - (a - 1.0) * cw - sa) / a0;
    }
    #[inline]
    pub fn process(&mut self, ch: usize, x: f32) -> f32 {
        let z = &mut self.z[ch];
        let y = self.b0 * x + z[0];
        z[0] = self.b1 * x - self.a1 * y + z[1];
        z[1] = self.b2 * x - self.a2 * y;
        y
    }
}
