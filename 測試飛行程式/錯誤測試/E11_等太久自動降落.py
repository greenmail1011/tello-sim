# 預期：停 20 秒時自動降落，接著的移動出錯
from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()
time.sleep(20)
tello.move_forward(100)
tello.land()
