# 預期：縮排錯誤
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
for i in range(4):
tello.move_forward(100)
tello.land()
