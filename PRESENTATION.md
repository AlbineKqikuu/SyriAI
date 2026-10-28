# Prezantimi: Kontrolli i një Gjeneratori të Thjeshtë
**Lënda: Teoria e Kontrollit**

---

## Slide 1: Titulli
*   **Tema:** Kontrolli i një Gjeneratori të Thjeshtë (Topic 18)
*   **Studenti:** Albina Kqiku
*   **Përmbledhja:** Modelimi, Analiza dhe Kontrolli PID/LQR i frekuencës.

---

## Slide 2: Problemi
*   Ndryshimi i ngarkesës ($\Delta P_L$) shkakton rënie të frekuencës.
*   Devijimet e mëdha dëmtojnë pajisjet elektrike.
*   Nevojitet kontroll automatik për të kthyer frekuencën në nominale.

---

## Slide 3: Modeli Matematik
*   **Swing Equation:** $M \dot{\Delta f} + D \Delta f = \Delta P_m - \Delta P_L$
*   **Turbina & Governor:** Modele të rendit të parë.
*   **Structure:** Sistemi i rendit të 3-të.

---

## Slide 4: Analiza e Stabilitetit
*   **Polet e sistemit:** Si tregon vendndodhja e tyre në planin S stabilitetin?
*   Rezultati: Sistemi është stabil pasi të gjitha polet janë në gjysmë-planin e majtë.

---

## Slide 5: Kontrolli PID
*   Shtimi i veprimit Integral ($\frac{1}{s}$) për eliminimin e gabimit.
*   Parametrat: $K_p$, $K_i$, $K_d$.
*   Performanca: Eliminon offset-in por mund të ketë oscilime.

---

## Slide 6: Kontrolli LQR (Modern)
*   Bazuar në feedback të gjendjeve.
*   Optimizon balancën mes performancës dhe energjisë së kontrollit.
*   Matrica Q (penalizimi i gabimit) dhe R (penalizimi i kontrollit).

---

## Slide 7: Rezultatet (Grafiqet)
*   Krahasimi: Pa Kontroll vs PID vs LQR.
*   Vëzhgimi: LQR ka përgjigjen më të mirë (më pak overshoot).

---

## Slide 8: Përfundime
*   Modelimi i saktë është baza e kontrollit.
*   LQR është më efikas për sisteme komplekse.
*   Python (libraria `control`) është mjet i fuqishëm për inxhinierinë.
