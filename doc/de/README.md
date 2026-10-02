![Logo](../../admin/sun2000.png)

# ioBroker.fusionsolar – Anleitung

Dieser Adapter liest die Daten Ihrer Huawei-PV-Anlage (SUN2000-Wechselrichter, LUNA2000-Batterien, Stromzähler, …) über die offizielle _Northbound-API_ aus der **Huawei-FusionSolar-Cloud** und stellt sie als ioBroker-Datenpunkte bereit.

> [!NOTE]
> Die Daten kommen aus der Cloud, **nicht** direkt vom Wechselrichter. Huawei aktualisiert sie nur alle 5 Minuten.
> Wer lokale Echtzeitdaten (Sekunden statt Minuten) braucht, sollte sich die Modbus-basierten Adapter ansehen
> (z. B. [ioBroker.sun2000](https://github.com/bolliy/ioBroker.sun2000)).

## Voraussetzungen

- ioBroker mit js-controller >= 6.0.11 und Admin >= 7.4.10
- Node.js >= 22
- ein **FusionSolar-Northbound-API-Account** (siehe unten)

### Der API-Account

Der Adapter funktioniert **nicht** mit Benutzername und Passwort der FusionSolar-App bzw. des Webportals!
Er benötigt einen separaten _Northbound-API-Account_:

- **Fragen Sie Ihren Installateur** – Installateure können ihn im FusionSolar-Webportal unter
  _System > Unternehmensverwaltung > Northbound-Verwaltung_ anlegen (die Menünamen können leicht abweichen).
  Wichtig: Der Account braucht Zugriff auf Ihre Anlage und auf die „Basis“-Schnittstellen der API.
- oder wenden Sie sich an den **Huawei-Support** (Europa: `eu_inverter_support@huawei.com`).

Sie erhalten einen Benutzernamen und ein Passwort (in der API-Dokumentation _System-Code_ genannt).

## Installation

Den Adapter wie jeden anderen Adapter über den Reiter _Adapter_ im ioBroker-Admin installieren und eine Instanz anlegen.

<details>
<summary>Aktuelle Entwicklungsversion von GitHub installieren</summary>

1. Im ioBroker-Admin den Expertenmodus aktivieren
2. Zum Reiter _Adapter_ wechseln und auf das GitHub-Symbol klicken (_Installieren aus eigener URL_)
3. Reiter _Benutzerdefiniert_ wählen und `https://github.com/KornSW/ioBroker.fusionsolar` eingeben
4. _Installieren_ klicken und anschließend eine Instanz anlegen

</details>

## Einstellungen

| Einstellung | Beschreibung |
| --- | --- |
| **API-Benutzername** / **API-Passwort** | Zugangsdaten des Northbound-API-Accounts (siehe oben). |
| **API-Server** | Hostname des FusionSolar-Servers Ihrer Region. Verwenden Sie den Hostnamen aus der Adresszeile Ihres Browsers, wenn Sie im FusionSolar-Webportal angemeldet sind (z. B. `eu5.fusionsolar.huawei.com`, `region01eu5.fusionsolar.huawei.com`, `intl.fusionsolar.huawei.com`). |
| **API-Generation** | API-Accounts, die nach dem 30.06.2022 angelegt wurden, müssen neuere Schnittstellen verwenden (Details, englisch: [API-GENERATIONS.md](../API-GENERATIONS.md)). Die _automatische Erkennung_ (Standard) probiert zuerst die 1. Generation und weicht sonst auf die 2. Generation aus. Nur explizit setzen, wenn die Erkennung bei Ihnen nicht funktioniert. |
| **Abfrageintervall in Sekunden** | Wie oft die Daten geladen werden. Minimum 60, **empfohlen 300** (Huawei aktualisiert die Daten nur alle 5 Minuten). |
| **Wartezeit zwischen API-Anfragen in Sekunden** | Pause zwischen zwei API-Aufrufen. Erhöhen, wenn Quota-Fehler auftreten. |
| **API-Anfragen bei Limit-Fehlern wiederholen** | Wiederholt einen Aufruf (bis zu 3-mal, mit steigender Wartezeit), wenn die API einen Limit-Fehler meldet (`failCode 407` oder HTTP 403). |
| **Geräte vom Typ 'Optimierer' überspringen** | Optimierer werden standardmäßig übersprungen – sie kosten zusätzliche API-Aufrufe. |
| **Geräte unbekannten Typs überspringen** | Dem Adapter unbekannte Gerätetypen werden standardmäßig übersprungen. Wenn deaktiviert, werden alle von der API gelieferten Werte als generische Datenpunkte angelegt. |

## Datenpunkte

Die Objekte werden unterhalb von `fusionsolar.<Instanz>` in folgender Struktur angelegt:

```
fusionsolar.0
├── info.connection                  true, wenn der letzte Abfragezyklus erfolgreich war
├── lastUpdate                       Zeitpunkt der letzten erfolgreichen Aktualisierung
└── <stationCode>                    ein Ordner pro Anlage, z. B. "NE=12345678"
    ├── stationName, capacity, ...   Anlageninformationen
    ├── kpi.realtime                 dayPower, monthPower, totalPower, dayIncome, totalIncome, realHealthState
    └── <deviceId>                   ein Ordner pro Gerät
        ├── devName, devTypeId, devTypeDesc, esnCode, invType, softwareVersion, ...
        ├── updatePriority           Ladehäufigkeit dieses Geräts (beschreibbar, siehe unten)
        └── kpi.realtime             Echtzeitwerte des Geräts
```

### Echtzeitwerte je Gerätetyp

| Gerätetyp (`devTypeId`) | Werte (Auswahl) |
| --- | --- |
| Wechselrichter (`1`, `38`) | `activePower` (kW), `reactivePower`, `efficiency` (%), `temperature` (°C), `elecFreq` (Hz), `dayCap` / `totalCap` (kWh), `runState`, `inverterState`, `AC.aU` / `AC.aI` … (je Phase), `MPPT.mpptPower`, `MPPT.mppt01Cap` …, `PV.pv01u` / `PV.pv01i` … (je String) |
| Batterie (`39`) | `batterySoc` (%), `batterySoh`, `chDischargePower` (W, positiv = Laden, negativ = Entladen), `batteryStatus`, `chargeCap` / `dischargeCap` (kWh), `maxChargePower` / `maxDischargePower` (W), `busbarU` (V) |
| Stromzähler (`47`) | `activePower` (W, je Phase: `activePowerA/B/C`), `reactivePower`, `meterU` / `meterI`, `bU`, `cU`, …, `gridFrequency` (Hz), `activeCap` (kWh), `reverseActiveCap` (kWh), … |
| Dongle (`62`) | die API liefert für Dongles keine Echtzeitwerte |
| Optimierer (`46`) und unbekannte Typen | alle von der API gelieferten Werte (nur wenn in den Einstellungen aktiviert) |

> [!TIP]
> Das Vorzeichen von `activePower` beim Zähler hängt davon ab, wie der Zähler eingebaut ist. Vergleichen Sie den Wert
> einmal mit der FusionSolar-App, um zu sehen, welches Vorzeichen Einspeisung bzw. Netzbezug bedeutet.

### Ladehäufigkeit pro Gerät (`updatePriority`)

Jedes Gerät hat einen beschreibbaren Datenpunkt `updatePriority`. Damit lassen sich API-Aufrufe für Geräte einsparen, deren Werte Ihnen weniger wichtig sind:

| Wert | Bedeutung | Beispiel bei 300 s Abfrageintervall |
| --- | --- | --- |
| 0 | nicht aktualisieren (Werte werden nur einmal nach dem Adapterstart geladen) | – |
| 1 | jedes Mal (Standard) | alle 5 min |
| 2 | jedes 2. Mal | alle 10 min |
| 3 | jedes 4. Mal | alle 20 min |
| 4 | jedes 8. Mal | alle 40 min |
| 5 | jedes 16. Mal | alle 80 min |
| 6 | jedes 32. Mal | alle 160 min |

Geräte desselben Typs werden mit einem einzigen API-Aufruf geladen – die Einstellung spart also nur dann Aufrufe, wenn sie für alle Geräte eines Typs gesetzt wird.

## API-Limits und Fehlersuche

Die FusionSolar-API ist stark limitiert. Als Faustregel darf jede Schnittstelle (Anlagenliste, Geräteliste, Anlagendaten, Gerätedaten je Gerätetyp) etwa einmal alle 5 Minuten aufgerufen werden. Der Adapter

- lädt die Anlagen- und Geräteliste nur beim Start und danach einmal täglich,
- lädt die Echtzeitwerte aller Geräte eines Typs mit einem einzigen Aufruf,
- wartet zwischen zwei Aufrufen (_Wartezeit zwischen API-Anfragen_) und
- verlängert nach Fehlern die Wartezeit exponentiell (bis maximal 1 Stunde).

| Meldung im Log | Ursache und Lösung |
| --- | --- |
| `Login failed ... please check user name and password` | Falsche Zugangsdaten, oder es wird der App-/Portal-Account statt des API-Accounts verwendet. Der Adapter wartet vor dem nächsten Login 1 Stunde, damit der Account nicht gesperrt wird. |
| `access frequency is too high (failCode 407)` / `HTTP 403` | Das API-Limit wurde überschritten. Abfrageintervall (empfohlen 300 s) und/oder Wartezeit zwischen API-Anfragen erhöhen. Denselben API-Account nicht gleichzeitig in mehreren Systemen verwenden. |
| `no permission to use this interface (failCode 401)` | Der API-Account hat keine Berechtigung für diese Schnittstelle, oder die API-Generation passt nicht. _API-Generation_ explizit setzen oder den Installateur bitten, die Berechtigungen zu erteilen. |
| `failCode 20056` | Der Anlagenbesitzer hat den API-Zugriff nicht (erneut) freigegeben. Der **Anlagenbesitzer** muss in der FusionSolar-App für die Anlage „API-Zugriff“ aktivieren bzw. bestätigen (nötig seit einem Huawei-Update im September 2025). |
| `failCode 20003` | Das Gültigkeitsdatum des API-Accounts ist abgelaufen – es kann in der _Northbound-Verwaltung_ verlängert werden. |
| `The API did not return any station` | Der API-Account ist Ihrer Anlage nicht zugeordnet – wenden Sie sich an Ihren Installateur. |
| Netzwerkfehler (`ECONNRESET`, `ETIMEDOUT`, …) | Internetverbindung des ioBroker-Hosts und die Einstellung _API-Server_ prüfen. |

Für eine genaue Analyse das Log-Level der Instanz auf `debug` stellen – dann werden die Anfragen und Antworten der API protokolliert (Passwort und Zugriffstoken werden nie geloggt).

## Hilfe

- Forum: [Thread im ioBroker-Forum](https://forum.iobroker.net/topic/59422/new-adapter-huawei-fusionsolar-api)
- Fehler und Wünsche: [GitHub-Issues](https://github.com/KornSW/ioBroker.fusionsolar/issues)
- Ausführlich (englisch): [API-Limits und Drosselung](../RATE-LIMITS.md), [API-Account-Generationen und Huawei-Änderungen](../API-GENERATIONS.md)
