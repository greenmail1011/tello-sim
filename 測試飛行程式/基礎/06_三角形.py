# 每次轉 120 度，飛一個正三角形
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

for i in range(3):
    tello.move_forward(150)
    tello.rotate_counter_clockwise(120)

tello.land()
