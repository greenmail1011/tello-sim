# 順時針轉 90 度四次，再逆時針轉一整圈
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

for i in range(4):
    tello.rotate_clockwise(90)

tello.rotate_counter_clockwise(360)
tello.land()
