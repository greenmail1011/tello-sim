# 最簡單的測試：起飛、停 3 秒、降落
from djitellopy import Tello
import time

tello = Tello()
tello.connect()
print("電量：", tello.get_battery(), "%")

tello.takeoff()
time.sleep(3)      # 在空中停 3 秒
tello.land()
