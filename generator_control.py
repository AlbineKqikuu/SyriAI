import numpy as np
import matplotlib.pyplot as plt
import control as ctrl
from scipy import signal

# Parameters (Standard normalized values)
M = 10.0  # Inertia constant (increased for stability)
D = 1.0   # Damping coefficient
Tg = 0.2  # Governor time constant
Tt = 0.5  # Turbine time constant
R = 0.05  # Droop coefficient

# 1. Mathematical Modeling (State-Space)
# x = [df, dPm, dPgv]^T
A = np.array([
    [-D/M, 1/M, 0],
    [0, -1/Tt, 1/Tt],
    [-1/(R*Tg), 0, -1/Tg]
])

B = np.array([[0], [0], [1/Tg]])
F = np.array([[-1/M], [0], [0]])
C = np.array([[1, 0, 0]])
D_sys = np.array([[0]])

sys_ss = ctrl.ss(A, B, C, D_sys)

print("--- System Analysis ---")
poles = ctrl.poles(sys_ss)
print(f"System Poles: {poles}")
is_stable = np.all(np.real(poles) < 0)
print(f"Is stable? {is_stable}")

# 2. Transfer Function for PID Analysis
s = ctrl.TransferFunction.s
G_plant = (1/(M*s + D)) * (1/(Tt*s + 1)) * (1/(Tg*s + 1))

# 3. PID Controller Design
# Manual PID: C(s) = Kp + Ki/s + Kd*s
Kp, Ki, Kd = 2.0, 0.5, 0.1
C_pid = Kp + Ki/s + Kd*s/(0.01*s + 1) # Filtered derivative for stability

# 4. LQR Controller Design
Q = np.diag([10, 1, 1]) # Penalize frequency deviation heavily
R_lqr = np.array([[1]])
K, S, E = ctrl.lqr(sys_ss, Q, R_lqr)
print(f"LQR Gain K: {K}")

# Closed loop LQR system
A_cl = A - B @ K
sys_lqr = ctrl.ss(A_cl, B, C, D_sys)

# 5. Simulations (Step Response to Load Disturbance)
# For step response to load change dPL = 0.1
t = np.linspace(0, 40, 1000)
dPL = 0.1

# Without control (Open Loop with droop already in A)
sys_open = ctrl.ss(A, F, C, [[0]])
t_open, y_open = ctrl.forced_response(sys_open, T=t, U=dPL)

# PID Response
# Corrected PID feedback loop: Plant is G_plant, Feedback is 1.
# But we must include secondary control. 
# Total feedback loop: dPL -> [M*s+D] -> f
# Power feedback: f -> [1/R + C_pid] -> [1/(Tt*s+1)][1/(Tg*s+1)] -> Pm
G_p = 1/(M*s + D)
G_c = (1/(Tt*s + 1)) * (1/(Tg*s + 1))
H_secondary = 1/R + C_pid
sys_pid_total = ctrl.feedback(G_p, G_c * H_secondary)
t_pid, y_pid = ctrl.step_response(sys_pid_total * dPL, T=t)

# LQR Response
sys_lqr_dist = ctrl.ss(A_cl, F, C, [[0]])
t_lqr, y_lqr = ctrl.forced_response(sys_lqr_dist, T=t, U=dPL)

# 6. Plotting
plt.figure(figsize=(12, 10))

# Subplot 1: Frequency Deviation
plt.subplot(2, 1, 1)
plt.plot(t_open, y_open, 'r--', label='Pa Kontroll Sekondar (Vetë-rregullim)')
plt.plot(t_pid, y_pid, 'g-', label='Kontroll PID')
plt.plot(t_lqr, y_lqr, 'b-', label='Kontroll LQR')
plt.axhline(0, color='black', lw=1)
plt.title('Përgjigjja e Frekuencës ndaj Ndryshimit të Ngarkesës (dPL = 0.1)')
plt.xlabel('Koha (s)')
plt.ylabel('Devijimi i Frekuencës (Hz)')
plt.legend()
plt.grid(True)

# Subplot 2: Control Signal
plt.subplot(2, 1, 2)
# LQR Control Signal: u = -K * x
t_lqr, y_lqr_s, x_lqr = ctrl.forced_response(sys_lqr_dist, T=t, U=dPL, return_x=True)
u_lqr = -K @ x_lqr
plt.plot(t, u_lqr.flatten(), 'b-', label='Sinjali i Kontrollit LQR')
plt.title('Sinjali i Kontrollit LQR')
plt.xlabel('Koha (s)')
plt.ylabel('Amplituda')
plt.legend()
plt.grid(True)

plt.tight_layout()
plt.savefig('generator_results.png')
print("Plots saved to generator_results.png")
# plt.show() # Disabled for headless run
