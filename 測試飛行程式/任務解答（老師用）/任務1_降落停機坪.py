# 任務 1 參考答案
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

tello.move_forward(200)   # 停機坪在正前方 2 公尺
tello.land()
