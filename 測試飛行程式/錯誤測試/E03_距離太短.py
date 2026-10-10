# 預期：錯誤，距離要在 20～500
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_forward(10)
tello.land()
