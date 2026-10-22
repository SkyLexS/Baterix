# Baterii periferice

Aplicație Electron care arată bateria perifericelor și te anunță când scade sub un prag.

## Pornire
1. Instalează Node.js (versiunea LTS) de pe nodejs.org.
2. În acest folder: `npm install`
3. `npm run start`

Aplicația pornește cu **date demo** (simulare), ca să vezi interfața și notificările. Dezactivează „Date demo” din subsol când driverele sunt gata.
Închiderea ferestrei o lasă să ruleze în system tray (clic dreapta pe pictogramă pentru ieșire).

## Descoperirea perifericelor
1. Conectează dongle-urile și pornește perifericele.
2. `npm run scan` listează dispozitivele HID. Trimite-mi rezultatul (sau fișierul `scanner/scan-output.json`).
3. Pentru a vedea ce trimite un dispozitiv: `npm run scan -- listen VID:PID`
   (de exemplu `listen 0951:1723`). Încarcă-l, oprește-l sau schimbă volumul și copiază-mi liniile apărute.
   Rezultatul se salvează și în `scanner/listen-log.txt`.

## Drivere
Fiecare periferic are un fișier în `drivers/`. Până la completare, cardul arată un slider pentru nivel manual.
