# Kara Bayrak — Fable-Haiku-Benchmark

Tarayıcıda çalışan 3D korsan gemisi oyunu (Three.js). Tek dosya (`index.html`), kurulum gerekmez.

**Benchmark:** Oyunun tüm kodu, Fable tarafından yönetilen **Haiku** alt-ajanlarıyla yazıldı. Mimari sözleşme: [`src/CONTRACT.md`](src/CONTRACT.md).

## Oyna
GitHub Pages: https://rarulora.github.io/Fable-Haiku-Benchmark/

## Özellikler
- Gerstner dalgalı okyanus (shader + CPU yüzerlik)
- Gemi kontrolü, borda topları, çok tipli düşman gemileri ve boss
- XP / level, level atlayınca 3 perkten birini seçme (yeni mekanikler)
- Prosedürel ses ve parçacık efektleri

## Geliştirme
```bash
node build.js   # lib/three.min.js + src/*.js -> index.html
node serve.js   # yerel sunucu
```

## Lisans
MIT — bkz. [LICENSE](LICENSE). Three.js (`lib/three.min.js`) MIT lisanslıdır.
