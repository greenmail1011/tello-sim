# 預期：錯誤，距離要是整數
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_forward(100 / 3)
tello.land()
