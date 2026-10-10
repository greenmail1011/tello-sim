# 預期：錯誤，並建議 move_forward()
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_foward(100)
tello.land()
