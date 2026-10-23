//! The Samples engine's reverb and chorus, so both engines put a song in the
//! same room.
//!
//! A line-for-line port of spessasynth's reverb (spessasynth_core 4.3,
//! `DattorroReverb` — Jon Dattorro's plate, after khoin's public-domain
//! DattorroReverbNode) with the settings it plays with in Orfeo: the plate's
//! own starting values. (spessasynth's GS "Hall 2" preset only arrives with a
//! GS reset, which Orfeo never sends.) Mono in (the sum of every channel's
//! reverb send), stereo out.

struct Delay { buf: Vec<f32>, write: usize, read: usize, mask: usize }

impl Delay {
    fn new(seconds: f64, rate: f64) -> Delay {
        let len = (seconds * rate).round() as usize;
        let size = len.next_power_of_two();
        Delay { buf: vec![0.0; size], write: len - 1, read: 0, mask: size - 1 }
    }
    #[inline] fn write(&mut self, s: f32) -> f32 { self.buf[self.write] = s; s }
    #[inline] fn read(&self) -> f32 { self.buf[self.read] }
    #[inline] fn read_at(&self, i: usize) -> f32 { self.buf[(self.read + i) & self.mask] }
    /// Cubic interpolation at a fractional offset (the modulated taps)
    #[inline] fn read_cubic_at(&self, i: f32) -> f32 {
        let frac = i - i.trunc();
        let mut n = (i.trunc() as isize + self.read as isize - 1) as usize;
        let m = self.mask;
        let x0 = self.buf[n & m]; n = n.wrapping_add(1);
        let x1 = self.buf[n & m]; n = n.wrapping_add(1);
        let x2 = self.buf[n & m]; n = n.wrapping_add(1);
        let x3 = self.buf[n & m];
        let a = (3.0 * (x1 - x2) - x0 + x3) / 2.0;
        let b = 2.0 * x2 + x0 - (5.0 * x1 + x3) / 2.0;
        let c = (x2 - x0) / 2.0;
        ((a * frac + b) * frac + c) * frac + x1
    }
    #[inline] fn advance(&mut self) { self.write = (self.write + 1) & self.mask; self.read = (self.read + 1) & self.mask; }
}

pub struct Reverb {
    d: Vec<Delay>,
    taps: [usize; 14],
    // the plate's starting values in spessasynth
    pre_lpf: f32, in_diff1: f32, in_diff2: f32, decay: f32, dec_diff1: f32, dec_diff2: f32,
    damping: f32, exc_rate: f32, exc_depth: f32, gain: f32,
    lp1: f32, lp2: f32, lp3: f32, exc_phase: f32,
}

impl Reverb {
    pub fn new(rate: f32) -> Reverb {
        let r = rate as f64;
        let lengths = [0.004771345, 0.003595309, 0.012734787, 0.009307483, 0.022579886, 0.149625349,
            0.060481839, 0.1249958, 0.030509727, 0.141695508, 0.089244313, 0.106280031];
        let taps = [0.008937872, 0.099929438, 0.064278754, 0.067067639, 0.066866033, 0.006283391, 0.035818689,
            0.011861161, 0.121870905, 0.041262054, 0.08981553, 0.070931756, 0.011256342, 0.004065724]
            .map(|x: f64| (x * r).round() as usize);
        Reverb {
            d: lengths.iter().map(|&s| Delay::new(s, r)).collect(), taps,
            pre_lpf: 0.5, in_diff1: 0.75, in_diff2: 0.625, decay: 0.5,
            dec_diff1: 0.7, dec_diff2: 0.5, damping: 0.005,
            exc_rate: 0.1 / rate, exc_depth: 0.2 * rate / 1000.0,
            gain: 1.0,
            lp1: 0.0, lp2: 0.0, lp3: 0.0, exc_phase: 0.0,
        }
    }

    /// Adds the reverb of `input` into `l` / `r`
    pub fn process(&mut self, input: &[f32], l: &mut [f32], r: &mut [f32]) {
        let (fi, si, dc, ft, st, dp) = (self.in_diff1, self.in_diff2, self.decay, self.dec_diff1, self.dec_diff2, 1.0 - self.damping);
        let t = self.taps;
        for i in 0..input.len() {
            let d = &mut self.d;
            // pre-delay is 0: the input goes straight in
            self.lp1 += self.pre_lpf * (input[i] - self.lp1);
            let r0 = d[0].read(); let mut pre = d[0].write(self.lp1 - fi * r0);
            let r1 = d[1].read(); pre = d[1].write(fi * (pre - r1) + r0);
            let r2 = d[2].read(); pre = d[2].write(fi * pre + r1 - si * r2);
            let r3 = d[3].read(); pre = d[3].write(si * (pre - r3) + r2);
            let split = si * pre + r3;
            let exc = self.exc_depth * (1.0 + (self.exc_phase * 6.28).cos());
            let exc2 = self.exc_depth * (1.0 + (self.exc_phase * 6.2847).sin());
            let c4 = d[4].read_cubic_at(exc);
            let r11 = d[11].read();
            let temp = d[4].write(split + dc * r11 + ft * c4);
            d[5].write(c4 - ft * temp);
            self.lp2 += dp * (d[5].read() - self.lp2);
            let r6 = d[6].read(); let temp = d[6].write(dc * self.lp2 - st * r6);
            d[7].write(r6 + st * temp);
            let c8 = d[8].read_cubic_at(exc2);
            let r7 = d[7].read();
            let temp = d[8].write(split + dc * r7 + ft * c8);
            d[9].write(c8 - ft * temp);
            self.lp3 += dp * (d[9].read() - self.lp3);
            let r10 = d[10].read(); let temp = d[10].write(dc * self.lp3 - st * r10);
            d[11].write(r10 + st * temp);
            let left = d[9].read_at(t[0]) + d[9].read_at(t[1]) - d[10].read_at(t[2]) + d[11].read_at(t[3])
                - d[5].read_at(t[4]) - d[6].read_at(t[5]) - d[7].read_at(t[6]);
            let right = d[5].read_at(t[7]) + d[5].read_at(t[8]) - d[6].read_at(t[9]) + d[7].read_at(t[10])
                - d[9].read_at(t[11]) - d[10].read_at(t[12]) - d[11].read_at(t[13]);
            l[i] += left * self.gain;
            r[i] += right * self.gain;
            self.exc_phase += self.exc_rate;
            for dl in d.iter_mut() { dl.advance() }
        }
    }
}

/// The Samples engine's chorus as it plays in Orfeo: spessasynth's chorus at
/// its starting values (no chorus preset arrives without a GS reset, which
/// Orfeo never sends) has no depth or rate — the send comes back unmodulated,
/// one sample late, at half level, the same on both sides.
pub struct Chorus { last: f32 }

impl Chorus {
    pub fn new() -> Chorus { Chorus { last: 0.0 } }
    /// Adds the chorus of `input` into `l` / `r`
    pub fn process(&mut self, input: &[f32], l: &mut [f32], r: &mut [f32]) {
        for i in 0..input.len() {
            let out = self.last * 0.5;
            l[i] += out; r[i] += out;
            self.last = input[i];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Reverb;
    #[test]
    fn same_room_as_the_samples_engine() {
        // an impulse, then a 0.2 s 440 Hz burst at 0.5 s, 3 s at 48 kHz: spessasynth 4.3.22's
        // plate gives -14.347 dB (energy per sample, both channels)
        let n = 48000 * 3;
        let mut input = vec![0f32; n];
        input[0] = 1.0;
        for i in 0..9600 { input[24000 + i] = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin() * 0.5 }
        let mut rv = Reverb::new(48000.0);
        let (mut l, mut r) = (vec![0f32; n], vec![0f32; n]);
        for s in (0..n).step_by(128) { rv.process(&input[s..s + 128], &mut l[s..s + 128], &mut r[s..s + 128]) }
        let e: f64 = l.iter().chain(r.iter()).map(|x| (*x as f64).powi(2)).sum::<f64>() / (2 * n) as f64;
        let db = 10.0 * e.log10();
        assert!((db + 14.347).abs() < 0.02, "{db}");
    }
}
