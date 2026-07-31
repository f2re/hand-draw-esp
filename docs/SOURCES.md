# Технические источники

Проект не копирует код FluidNC или Makerbase. Перечисленные источники используются для выбора интерфейсов, карты выводов и проверки команд.

## Прошивка и протокол

- [FluidNC](https://github.com/bdring/FluidNC) — прошивка ESP32, формат `config.yaml`, WebUI и Grbl-совместимый протокол.
- [FluidNC: Commands and Settings](https://github.com/bdring/FluidNC/wiki/FluidNC-Commands-and-Settings) — `$H`, `$X`, `$SD/Run`, `$LocalFS/Run`, realtime-команды и параметры.
- [FluidNC: SD Card](https://github.com/bdring/FluidNC/wiki/SD-Card) — логическая адресация файлов SD и запуск из корня карты.
- [FluidNC configuration examples](https://github.com/bdring/fluidnc-config-files) — официальные примеры плат, I2S-STEP/DIR и `rc_servo`.
- [FluidNC WebUI source](https://github.com/bdring/FluidNC/tree/main/embedded/www) — фактический формат WebSocket и multipart-файлового API `/files`.

## Аппаратная часть

- [Makerbase MKS DLC32](https://github.com/makerbase-mks/MKS-DLC32) — схемы, распиновка и ревизии платы.
- [TowerPro MG90S](https://towerpro.com.tw/product/mg90s-3/) — номинальное питание и габариты оригинального сервопривода. Размеры клонов необходимо измерять.
- [HIWIN miniature linear guideways](https://www.hiwin.us/products/linear-guideways/miniature-linear-guideways/) — номинальная геометрия серии MGN. Недорогие совместимые рельсы могут отличаться.

## Инженерные допущения проекта

- Масштаб 80 шагов/мм получен для двигателя 200 шагов/оборот, микрошагов 1/16, ремня с шагом 2 мм и шкива 20T.
- Размеры печатных деталей параметрические; перед финальной печатью обязательны измерение приобретённых компонентов и тестовые купоны.
- Оценка времени в WebUI учитывает длину перемещений и выдержки пера, но не является точной моделью ускорений FluidNC.
- Схемы в `docs/images` поясняют структуру; размеры, подключение и порядок сборки определяются текстовой документацией и параметрическими моделями.

Состояние внешних источников проверено 31 июля 2026 года. При обновлении FluidNC необходимо повторно проверить файловый API, WebSocket-отчёты, синтаксис YAML и команды запуска файлов.
