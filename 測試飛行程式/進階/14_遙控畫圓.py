# send_rc_control：一邊前進一邊旋轉就會繞圓
from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()

tello.send_rc_control(0, 40, 0, 40)   # 前進 40、順時針旋轉 40
time.sleep(9)

tello.send_rc_control(0, 0, 0, 0)     # 停下來
time.sleep(1)
tello.land()
