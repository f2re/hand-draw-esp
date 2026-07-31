# FluidNC для HandDraw ESP

Полная инструкция первичной прошивки: [`INSTALL.md`](INSTALL.md).

`config.yaml` рассчитан на MKS DLC32 V2.1 и механику:

- Cartesian XY;
- GT2 20T;
- NEMA17 1,8°;
- микрошаг 1/16;
- 80 шагов/мм;
- X 225 мм;
- Y 315 мм;
- RC-servo на GPIO32 как ось Z 0…5 мм.

## Важные команды

```text
$H                         homing
$X                         снять alarm
?                          отчёт состояния
!                          пауза
~                          продолжить
Ctrl-X                     программный reset
G0 Z5                      поднять ручку
G0 Z0                      опустить ручку
$SD/Run=/jobs/a.gcode      запустить задание с SD
```

`must_home: false` предназначен для ввода в эксплуатацию. После верификации обоих концевиков установить `true`.

Драйверы работают в standalone STEP/DIR; UART не требуется.
