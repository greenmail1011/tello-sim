# 先在右上角選「任務 3」再執行。預期：撞到柱子
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()
tello.move_forward(400)
tello.land()
