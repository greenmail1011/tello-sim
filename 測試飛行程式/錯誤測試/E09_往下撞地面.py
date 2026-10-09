# 預期：錯誤，會撞到地面
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_down(100)
tello.land()
