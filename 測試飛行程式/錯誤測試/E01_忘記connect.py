# 預期：錯誤，還沒連線
from djitellopy import Tello

tello = Tello()
tello.takeoff()
tello.land()
