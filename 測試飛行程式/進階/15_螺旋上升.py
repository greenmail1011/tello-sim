# 遙控模式：一邊繞圈一邊往上升
from djitellopy import Tello
import time

tello = Tello()
tello.connect()
tello.takeoff()

tello.send_rc_control(0, 30, 15, 45)  # 前進、上升、旋轉 同時進行
time.sleep(8)

tello.send_rc_control(0, 0, 0, 0)
print("爬到高度：", tello.get_height(), "公分")
tello.land()
