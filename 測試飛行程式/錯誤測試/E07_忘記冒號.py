# 預期：語法錯誤，提示要加冒號
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
for i in range(4)
    tello.move_forward(100)
tello.land()
